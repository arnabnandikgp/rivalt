"""Verify D84 entrypoint/footer and complete declared context revision coverage.

This is a source-level guard, not ABI, compiled rollback or RPC evidence. Unknown
context syntax fails closed instead of silently omitting a financial dependency.
"""
from pathlib import Path
import re

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / 'programs/clearing/src'
KINDS = ('Venue', 'Custody', 'VenueSafety', 'VenueRegistry', 'Portfolio',
         'MarginAccount', 'Market', 'MarketLedger', 'CapitalBinding',
         'SettlementCertificate', 'Resolution', 'ResolutionPage', 'ResolutionWork',
         'RetirementCertificate', 'LiquidityRegistry', 'MakerRegistration', 'FundingPublisher')


def declarations():
    contexts = {}
    for path in (SOURCE / 'instructions').rglob('*.rs'):
        text = path.read_text()
        for match in re.finditer(r"pub struct (\w+)<'info> \{([^}]+)\}", text, re.S):
            name, body = match.groups()
            assert name not in contexts, name
            fields = []
            previous = 0
            for field in re.finditer(r'pub (\w+): ([^\n]+),', body):
                attributes = body[previous:field.start()]
                previous = field.end()
                field_name, field_type = field.groups()
                access = 'Create' if re.search(r'\binit\b', attributes) else (
                    'Write' if re.search(r'\bmut\b', attributes) else 'Read')
                fields.append((field_name, field_type, access))
            contexts[name] = fields
    return contexts


def flatten(contexts, name, prefix=''):
    rows = {}
    for field, field_type, access in contexts[name]:
        path = prefix + field
        account = re.search(r"Account<'info, (\w+)>", field_type)
        if account:
            if account[1] in KINDS:
                rows[path] = (access, field_type.startswith('Option<'))
            else:
                assert account[1] in ('Mint', 'TokenAccount', 'ProgramData'), (name, field_type)
        else:
            simple = re.fullmatch(r"(\w+)<'info>", field_type)
            assert simple or field_type.startswith(('Program<', 'Option<Signer<', 'Option<Program<', 'Option<UncheckedAccount<')), (name, field_type)
            if simple and simple[1] in contexts:
                rows.update(flatten(contexts, simple[1], path + '.'))
            elif simple:
                assert simple[1] in ('Signer', 'UncheckedAccount', 'Program'), (name, field_type)
    return rows


def check():
    contexts = declarations()
    table = (SOURCE / 'instructions/scopes.rs').read_text()
    covered = {}
    for match in re.finditer(r'context!\(\s*(\w+),\s*([\w.]+),\s*([\w.]+);\s*\[([^]]*)\];\s*\[([^]]*)\]\s*\);', table, re.S):
        name, venue, authority, fixed, optional = match.groups()
        assert name not in covered, name
        entries = {}
        for body, is_optional in ((fixed, False), (optional, True)):
            for item in body.split(','):
                if not item.strip():
                    continue
                field, access = map(str.strip, item.split(':'))
                assert access in ('Read', 'Write', 'Create') and field not in entries, (name, item)
                entries[field] = (access, is_optional)
        assert entries == flatten(contexts, name), (name, entries, flatten(contexts, name))
        assert venue.endswith('venue') and venue in entries, name
        assert authority == ('qualification.event_authority' if name == 'ActivateAccounts' else 'event_authority'), name
        covered[name] = entries
    lib = (SOURCE / 'lib.rs').read_text()
    handlers = list(re.finditer(r'#\[instruction\(discriminator = (\[[^]]+\])\)\]\s*pub fn (\w+)\(\s*ctx: Context<(\w+)>,?[^{}]*\) -> Result<\(\)> \{', lib, re.S))
    assert len(handlers) == len(re.findall(r'pub fn ', lib)) == 53
    used = set()
    for match in handlers:
        discriminator, name, context = match.groups()
        used.add(context)
        end, depth = match.end(), 1
        while depth:
            depth += (lib[end] == '{') - (lib[end] == '}')
            end += 1
        body = re.sub(r'\s+', '', lib[match.end():end-1])
        expected = 'stage == account_safety::resolution::APPLY' if name == 'advance_account_resolution' else 'false'
        prefix = re.sub(r'\s+', '', f'scoped_history::run(ctx,{discriminator},{expected},|ctx,events|')
        assert body.startswith(prefix) and body.endswith(',)'), name
        handler = body[len(prefix):-2].strip('{}')
        assert re.fullmatch(r'[\w:]+\(ctx,events(?:,[^;{}]+)?\)', handler), (name, handler)
    assert used == set(covered), (used ^ set(covered))
    for path in (SOURCE / 'instructions').rglob('*.rs'):
        text = path.read_text()
        assert 'emit_cpi!' not in text and 'crate::event_cpi::emit' not in text, path
        assert not re.search(r'custody\.sequence|custody_sequence', text), path
    print(f'Scoped history: {len(handlers)} entrypoints, {len(covered)} contexts, complete nested/optional access coverage')


if __name__ == '__main__':
    check()

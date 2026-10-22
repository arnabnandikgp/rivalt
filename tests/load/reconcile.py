"""Independent integer conservation over an actual coherent chain cohort."""
import json
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'e2e'))
from matrix import reconcile

if __name__ == '__main__':
    sample=json.loads(Path(sys.argv[1]).read_text())
    chain=sample['chain']
    print(json.dumps(reconcile({'market':chain['market'],'participants':chain['participants'],'risk':chain['risk']},
                              chain['actualVault'],chain['registry']['members'])))

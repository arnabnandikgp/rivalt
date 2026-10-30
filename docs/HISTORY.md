# History and original evidence

Current contracts live in the component guides. This index preserves provenance;
a historical result applies only to its recorded code/artifacts and scope. The
original 111 documents (110 pre-planning plus consolidation plan) are available
at commit `84c46d4d26b23f25d6f3a7ae4bcbec591fa31503`. No tracked archive or evidence directory is maintained.
Ignored raw captures remain at their existing local paths; this change moves or
deletes none of them. Recovery example:

```sh
git show 84c46d4d26b23f25d6f3a7ae4bcbec591fa31503:docs/evidence/P34.md
```

## Integrated milestones

| Milestone | Scope | Integration / retained actual checks |
|---|---|---|
| M1 | Stack/custody | 3c1aae1; original tool/SDK/RPC and independent custody |
| M2–M5b | Original engineering MVP, services, bounded qualification, devnet | 2bc298e; devnet closeout 67059fc; historical profile only |
| M6 engineering A | Maker kit/reliability | 74fc296; independent B gates remain Open |
| M7 | Two-market group successor | d07fccc; complete group safety, separate historical loss model |
| M8 | Account-centric clearing | 0916b9d; market-attributed loss/insurance, funded exits and complete safety |
| M9 | Interactive earlier-profile demo | 350e60c; user walkthrough and owned lifecycle |
| M10 | Canonical maker liquidity/publisher/services | b80bb38; exact reviewed tree 9e6dd07, docs closeout 1f1a5aa |
| M11 | Repository consolidation | In progress; current status and PR verification in STATUS |

Original WORKLOG contains every actual tested pin, failed attempt, command and raw
local path. Current [validation](operations/validation.md) retains the applicable
qualification/limits without duplicating each run. Independent review, production
scale, external maker economics and 24-hour endurance do not follow from these rows.

## Document disposition

Every original source has a destination below. A destination owns surviving
current requirements, not old profile economics. Historical-only documents keep
an immutable original link; they are not silently promoted into current policy.
The main split contracts are: P22B executable → accounts, accounting and risk/default;
P29B → quoting, routing and current funding; P27/P33 → interfaces and durability.
The obsolete on-chain sampler remains historical; current funding is D75/D76.
Original evidence summaries inform validation but are not new acceptance.

| Original at 84c46d4d26b23f25d6f3a7ae4bcbec591fa31503 | Current owner / disposition |
|---|---|
| [01-PRODUCT.md](https://github.com/arnabnandikgp/rivalt/blob/84c46d4d26b23f25d6f3a7ae4bcbec591fa31503/docs/01-PRODUCT.md) | Current requirements in [README.md](README.md) |
| [02-PROTOCOL.md](https://github.com/arnabnandikgp/rivalt/blob/84c46d4d26b23f25d6f3a7ae4bcbec591fa31503/docs/02-PROTOCOL.md) | Current requirements in [clearing/accounting.md](clearing/accounting.md) |
| [03-COMPONENTS.md](https://github.com/arnabnandikgp/rivalt/blob/84c46d4d26b23f25d6f3a7ae4bcbec591fa31503/docs/03-COMPONENTS.md) | Current requirements in [README.md](README.md) |
| [04-STACK-AND-VALIDATION.md](https://github.com/arnabnandikgp/rivalt/blob/84c46d4d26b23f25d6f3a7ae4bcbec591fa31503/docs/04-STACK-AND-VALIDATION.md) | Current requirements in [operations/validation.md](operations/validation.md) |
| [05-DELIVERY-PLAN.md](https://github.com/arnabnandikgp/rivalt/blob/84c46d4d26b23f25d6f3a7ae4bcbec591fa31503/docs/05-DELIVERY-PLAN.md) | Current requirements in [STATUS.md](STATUS.md) |
| [DECISIONS.md](https://github.com/arnabnandikgp/rivalt/blob/84c46d4d26b23f25d6f3a7ae4bcbec591fa31503/docs/DECISIONS.md) | Current requirements in [DECISIONS.md](DECISIONS.md) |
| [ENGINEERING-MVP.md](https://github.com/arnabnandikgp/rivalt/blob/84c46d4d26b23f25d6f3a7ae4bcbec591fa31503/docs/ENGINEERING-MVP.md) | Current requirements in [operations/validation.md](operations/validation.md) |
| [EVIDENCE.md](https://github.com/arnabnandikgp/rivalt/blob/84c46d4d26b23f25d6f3a7ae4bcbec591fa31503/docs/EVIDENCE.md) | Current requirements in [operations/validation.md](operations/validation.md) |
| [MAKER-QUOTING-ASSESSMENT.md](https://github.com/arnabnandikgp/rivalt/blob/84c46d4d26b23f25d6f3a7ae4bcbec591fa31503/docs/MAKER-QUOTING-ASSESSMENT.md) | Historical rationale only; [HISTORY.md](HISTORY.md) |
| [P01-SPINE.md](https://github.com/arnabnandikgp/rivalt/blob/84c46d4d26b23f25d6f3a7ae4bcbec591fa31503/docs/P01-SPINE.md) | Current requirements in [operations/local-development.md](operations/local-development.md) |
| [P02-ACCOUNTING-AND-CUSTODY.md](https://github.com/arnabnandikgp/rivalt/blob/84c46d4d26b23f25d6f3a7ae4bcbec591fa31503/docs/P02-ACCOUNTING-AND-CUSTODY.md) | Current requirements in [clearing/accounting.md](clearing/accounting.md) |
| [P03-MAKER-CONTRACT.md](https://github.com/arnabnandikgp/rivalt/blob/84c46d4d26b23f25d6f3a7ae4bcbec591fa31503/docs/P03-MAKER-CONTRACT.md) | Current requirements in [liquidity/quoting.md](liquidity/quoting.md) |
| [P04-ATOMIC-ROUTES.md](https://github.com/arnabnandikgp/rivalt/blob/84c46d4d26b23f25d6f3a7ae4bcbec591fa31503/docs/P04-ATOMIC-ROUTES.md) | Current requirements in [liquidity/routing.md](liquidity/routing.md) |
| [P05-INDEXER.md](https://github.com/arnabnandikgp/rivalt/blob/84c46d4d26b23f25d6f3a7ae4bcbec591fa31503/docs/P05-INDEXER.md) | Current requirements in [application/durability.md](application/durability.md) |
| [P06-LIFECYCLE.md](https://github.com/arnabnandikgp/rivalt/blob/84c46d4d26b23f25d6f3a7ae4bcbec591fa31503/docs/P06-LIFECYCLE.md) | Current requirements in [clearing/accounting.md](clearing/accounting.md) |
| [P07-ORACLE-AND-FUNDING.md](https://github.com/arnabnandikgp/rivalt/blob/84c46d4d26b23f25d6f3a7ae4bcbec591fa31503/docs/P07-ORACLE-AND-FUNDING.md) | Current requirements in [clearing/risk-and-resolution.md](clearing/risk-and-resolution.md) |
| [P08-ORDERS.md](https://github.com/arnabnandikgp/rivalt/blob/84c46d4d26b23f25d6f3a7ae4bcbec591fa31503/docs/P08-ORDERS.md) | Current requirements in [clearing/risk-and-resolution.md](clearing/risk-and-resolution.md) |
| [P09-RESOLUTION.md](https://github.com/arnabnandikgp/rivalt/blob/84c46d4d26b23f25d6f3a7ae4bcbec591fa31503/docs/P09-RESOLUTION.md) | Current requirements in [clearing/risk-and-resolution.md](clearing/risk-and-resolution.md) |
| [P10-TRADER.md](https://github.com/arnabnandikgp/rivalt/blob/84c46d4d26b23f25d6f3a7ae4bcbec591fa31503/docs/P10-TRADER.md) | Current requirements in [application/interfaces.md](application/interfaces.md) |
| [P11-MATRIX.md](https://github.com/arnabnandikgp/rivalt/blob/84c46d4d26b23f25d6f3a7ae4bcbec591fa31503/docs/P11-MATRIX.md) | Current requirements in [operations/validation.md](operations/validation.md) |
| [P12-LOAD-SOAK.md](https://github.com/arnabnandikgp/rivalt/blob/84c46d4d26b23f25d6f3a7ae4bcbec591fa31503/docs/P12-LOAD-SOAK.md) | Current requirements in [operations/validation.md](operations/validation.md) |
| [P13-DEVNET.md](https://github.com/arnabnandikgp/rivalt/blob/84c46d4d26b23f25d6f3a7ae4bcbec591fa31503/docs/P13-DEVNET.md) | Current requirements in [operations/deployment.md](operations/deployment.md) |
| [P14-DEVNET-LIFECYCLE.md](https://github.com/arnabnandikgp/rivalt/blob/84c46d4d26b23f25d6f3a7ae4bcbec591fa31503/docs/P14-DEVNET-LIFECYCLE.md) | Current requirements in [operations/deployment.md](operations/deployment.md) |
| [P15A-MAKER-KIT.md](https://github.com/arnabnandikgp/rivalt/blob/84c46d4d26b23f25d6f3a7ae4bcbec591fa31503/docs/P15A-MAKER-KIT.md) | Current requirements in [operations/deployment.md](operations/deployment.md) |
| [P16A-OPERATIONS.md](https://github.com/arnabnandikgp/rivalt/blob/84c46d4d26b23f25d6f3a7ae4bcbec591fa31503/docs/P16A-OPERATIONS.md) | Current requirements in [operations/README.md](operations/README.md) |
| [P17-MARGIN-CONTRACT.md](https://github.com/arnabnandikgp/rivalt/blob/84c46d4d26b23f25d6f3a7ae4bcbec591fa31503/docs/P17-MARGIN-CONTRACT.md) | Current requirements in [clearing/accounts.md](clearing/accounts.md) |
| [P18A-GROUP-CUSTODY.md](https://github.com/arnabnandikgp/rivalt/blob/84c46d4d26b23f25d6f3a7ae4bcbec591fa31503/docs/P18A-GROUP-CUSTODY.md) | Current requirements in [clearing/accounts.md](clearing/accounts.md) |
| [P18B-ISOLATED-PRIMITIVES.md](https://github.com/arnabnandikgp/rivalt/blob/84c46d4d26b23f25d6f3a7ae4bcbec591fa31503/docs/P18B-ISOLATED-PRIMITIVES.md) | Current requirements in [clearing/risk-and-resolution.md](clearing/risk-and-resolution.md) |
| [P18C-GROUP-SAFETY.md](https://github.com/arnabnandikgp/rivalt/blob/84c46d4d26b23f25d6f3a7ae4bcbec591fa31503/docs/P18C-GROUP-SAFETY.md) | Current requirements in [clearing/risk-and-resolution.md](clearing/risk-and-resolution.md) |
| [P19-CROSS-CORE.md](https://github.com/arnabnandikgp/rivalt/blob/84c46d4d26b23f25d6f3a7ae4bcbec591fa31503/docs/P19-CROSS-CORE.md) | Current requirements in [clearing/risk-and-resolution.md](clearing/risk-and-resolution.md) |
| [P20-CROSS-SAFETY.md](https://github.com/arnabnandikgp/rivalt/blob/84c46d4d26b23f25d6f3a7ae4bcbec591fa31503/docs/P20-CROSS-SAFETY.md) | Current requirements in [clearing/risk-and-resolution.md](clearing/risk-and-resolution.md) |
| [P21A-INTERFACES.md](https://github.com/arnabnandikgp/rivalt/blob/84c46d4d26b23f25d6f3a7ae4bcbec591fa31503/docs/P21A-INTERFACES.md) | Current requirements in [application/durability.md](application/durability.md) |
| [P21B-QUALIFICATION.md](https://github.com/arnabnandikgp/rivalt/blob/84c46d4d26b23f25d6f3a7ae4bcbec591fa31503/docs/P21B-QUALIFICATION.md) | Current requirements in [operations/validation.md](operations/validation.md) |
| [P22-ACCOUNT-CENTRIC-CLEARING.md](https://github.com/arnabnandikgp/rivalt/blob/84c46d4d26b23f25d6f3a7ae4bcbec591fa31503/docs/P22-ACCOUNT-CENTRIC-CLEARING.md) | Current requirements in [clearing/accounts.md](clearing/accounts.md) |
| [P22B-CLEARING-REFERENCE.md](https://github.com/arnabnandikgp/rivalt/blob/84c46d4d26b23f25d6f3a7ae4bcbec591fa31503/docs/P22B-CLEARING-REFERENCE.md) | Current requirements in [clearing/risk-and-resolution.md](clearing/risk-and-resolution.md) |
| [P22B-EXECUTABLE-CONTRACT.md](https://github.com/arnabnandikgp/rivalt/blob/84c46d4d26b23f25d6f3a7ae4bcbec591fa31503/docs/P22B-EXECUTABLE-CONTRACT.md) | Current requirements in [clearing/accounts.md](clearing/accounts.md) |
| [P22B-FINANCIAL-CONTRACT.md](https://github.com/arnabnandikgp/rivalt/blob/84c46d4d26b23f25d6f3a7ae4bcbec591fa31503/docs/P22B-FINANCIAL-CONTRACT.md) | Current requirements in [clearing/accounting.md](clearing/accounting.md) |
| [P23-ACCOUNT-CUSTODY.md](https://github.com/arnabnandikgp/rivalt/blob/84c46d4d26b23f25d6f3a7ae4bcbec591fa31503/docs/P23-ACCOUNT-CUSTODY.md) | Current requirements in [clearing/accounts.md](clearing/accounts.md) |
| [P24-ACCOUNT-TRADING.md](https://github.com/arnabnandikgp/rivalt/blob/84c46d4d26b23f25d6f3a7ae4bcbec591fa31503/docs/P24-ACCOUNT-TRADING.md) | Current requirements in [clearing/risk-and-resolution.md](clearing/risk-and-resolution.md) |
| [P25-ACCOUNT-CASH.md](https://github.com/arnabnandikgp/rivalt/blob/84c46d4d26b23f25d6f3a7ae4bcbec591fa31503/docs/P25-ACCOUNT-CASH.md) | Current requirements in [clearing/accounting.md](clearing/accounting.md) |
| [P26-ACCOUNT-SAFETY.md](https://github.com/arnabnandikgp/rivalt/blob/84c46d4d26b23f25d6f3a7ae4bcbec591fa31503/docs/P26-ACCOUNT-SAFETY.md) | Current requirements in [clearing/risk-and-resolution.md](clearing/risk-and-resolution.md) |
| [P27-ACCOUNT-SERVICES.md](https://github.com/arnabnandikgp/rivalt/blob/84c46d4d26b23f25d6f3a7ae4bcbec591fa31503/docs/P27-ACCOUNT-SERVICES.md) | Current requirements in [application/durability.md](application/durability.md) |
| [P28-ACCOUNT-QUALIFICATION.md](https://github.com/arnabnandikgp/rivalt/blob/84c46d4d26b23f25d6f3a7ae4bcbec591fa31503/docs/P28-ACCOUNT-QUALIFICATION.md) | Current requirements in [operations/validation.md](operations/validation.md) |
| [P28-OPERATIONS.md](https://github.com/arnabnandikgp/rivalt/blob/84c46d4d26b23f25d6f3a7ae4bcbec591fa31503/docs/P28-OPERATIONS.md) | Current requirements in [operations/README.md](operations/README.md) |
| [P28A-LOCAL-DEMO.md](https://github.com/arnabnandikgp/rivalt/blob/84c46d4d26b23f25d6f3a7ae4bcbec591fa31503/docs/P28A-LOCAL-DEMO.md) | Current requirements in [operations/local-development.md](operations/local-development.md) |
| [P29-MAKER-LIQUIDITY-ROADMAP.md](https://github.com/arnabnandikgp/rivalt/blob/84c46d4d26b23f25d6f3a7ae4bcbec591fa31503/docs/P29-MAKER-LIQUIDITY-ROADMAP.md) | Historical rationale only; [HISTORY.md](HISTORY.md) |
| [P29B-MAKER-CONTRACT.md](https://github.com/arnabnandikgp/rivalt/blob/84c46d4d26b23f25d6f3a7ae4bcbec591fa31503/docs/P29B-MAKER-CONTRACT.md) | Current requirements in [liquidity/quoting.md](liquidity/quoting.md) |
| [P30-CANONICAL-MAKERS.md](https://github.com/arnabnandikgp/rivalt/blob/84c46d4d26b23f25d6f3a7ae4bcbec591fa31503/docs/P30-CANONICAL-MAKERS.md) | Current requirements in [liquidity/quoting.md](liquidity/quoting.md) |
| [P31-EXACT-ROUTING.md](https://github.com/arnabnandikgp/rivalt/blob/84c46d4d26b23f25d6f3a7ae4bcbec591fa31503/docs/P31-EXACT-ROUTING.md) | Current requirements in [liquidity/routing.md](liquidity/routing.md) |
| [P32-FUNDING-PUBLISHER.md](https://github.com/arnabnandikgp/rivalt/blob/84c46d4d26b23f25d6f3a7ae4bcbec591fa31503/docs/P32-FUNDING-PUBLISHER.md) | Current requirements in [liquidity/funding.md](liquidity/funding.md) |
| [P32-LIQUIDITY-EXECUTION.md](https://github.com/arnabnandikgp/rivalt/blob/84c46d4d26b23f25d6f3a7ae4bcbec591fa31503/docs/P32-LIQUIDITY-EXECUTION.md) | Current requirements in [liquidity/routing.md](liquidity/routing.md) |
| [P33-LIQUIDITY-SERVICES.md](https://github.com/arnabnandikgp/rivalt/blob/84c46d4d26b23f25d6f3a7ae4bcbec591fa31503/docs/P33-LIQUIDITY-SERVICES.md) | Current requirements in [application/durability.md](application/durability.md) |
| [P33-MAKER-KIT.md](https://github.com/arnabnandikgp/rivalt/blob/84c46d4d26b23f25d6f3a7ae4bcbec591fa31503/docs/P33-MAKER-KIT.md) | Current requirements in [operations/deployment.md](operations/deployment.md) |
| [P34-LIQUIDITY-QUALIFICATION.md](https://github.com/arnabnandikgp/rivalt/blob/84c46d4d26b23f25d6f3a7ae4bcbec591fa31503/docs/P34-LIQUIDITY-QUALIFICATION.md) | Current requirements in [operations/validation.md](operations/validation.md) |
| [P34-OPERATIONS.md](https://github.com/arnabnandikgp/rivalt/blob/84c46d4d26b23f25d6f3a7ae4bcbec591fa31503/docs/P34-OPERATIONS.md) | Current requirements in [operations/README.md](operations/README.md) |
| [REPOSITORY-CONSOLIDATION.md](https://github.com/arnabnandikgp/rivalt/blob/84c46d4d26b23f25d6f3a7ae4bcbec591fa31503/docs/REPOSITORY-CONSOLIDATION.md) | Current requirements in [REPOSITORY-CONSOLIDATION.md](REPOSITORY-CONSOLIDATION.md) |
| [SOURCE-AUDIT.md](https://github.com/arnabnandikgp/rivalt/blob/84c46d4d26b23f25d6f3a7ae4bcbec591fa31503/docs/SOURCE-AUDIT.md) | Historical rationale only; [HISTORY.md](HISTORY.md) |
| [STACK-CLEANUP.md](https://github.com/arnabnandikgp/rivalt/blob/84c46d4d26b23f25d6f3a7ae4bcbec591fa31503/docs/STACK-CLEANUP.md) | Current requirements in [operations/validation.md](operations/validation.md) |
| [WORKLOG.md](https://github.com/arnabnandikgp/rivalt/blob/84c46d4d26b23f25d6f3a7ae4bcbec591fa31503/docs/WORKLOG.md) | Current requirements in [STATUS.md](STATUS.md) |
| [evidence/P01.md](https://github.com/arnabnandikgp/rivalt/blob/84c46d4d26b23f25d6f3a7ae4bcbec591fa31503/docs/evidence/P01.md) | Historical report; applicable claims in [operations/validation.md](operations/validation.md) |
| [evidence/P02.md](https://github.com/arnabnandikgp/rivalt/blob/84c46d4d26b23f25d6f3a7ae4bcbec591fa31503/docs/evidence/P02.md) | Historical report; applicable claims in [operations/validation.md](operations/validation.md) |
| [evidence/P03.md](https://github.com/arnabnandikgp/rivalt/blob/84c46d4d26b23f25d6f3a7ae4bcbec591fa31503/docs/evidence/P03.md) | Historical report; applicable claims in [operations/validation.md](operations/validation.md) |
| [evidence/P04.md](https://github.com/arnabnandikgp/rivalt/blob/84c46d4d26b23f25d6f3a7ae4bcbec591fa31503/docs/evidence/P04.md) | Historical report; applicable claims in [operations/validation.md](operations/validation.md) |
| [evidence/P05.md](https://github.com/arnabnandikgp/rivalt/blob/84c46d4d26b23f25d6f3a7ae4bcbec591fa31503/docs/evidence/P05.md) | Historical report; applicable claims in [operations/validation.md](operations/validation.md) |
| [evidence/P06.md](https://github.com/arnabnandikgp/rivalt/blob/84c46d4d26b23f25d6f3a7ae4bcbec591fa31503/docs/evidence/P06.md) | Historical report; applicable claims in [operations/validation.md](operations/validation.md) |
| [evidence/P07.md](https://github.com/arnabnandikgp/rivalt/blob/84c46d4d26b23f25d6f3a7ae4bcbec591fa31503/docs/evidence/P07.md) | Historical report; applicable claims in [operations/validation.md](operations/validation.md) |
| [evidence/P08.md](https://github.com/arnabnandikgp/rivalt/blob/84c46d4d26b23f25d6f3a7ae4bcbec591fa31503/docs/evidence/P08.md) | Historical report; applicable claims in [operations/validation.md](operations/validation.md) |
| [evidence/P09.md](https://github.com/arnabnandikgp/rivalt/blob/84c46d4d26b23f25d6f3a7ae4bcbec591fa31503/docs/evidence/P09.md) | Historical report; applicable claims in [operations/validation.md](operations/validation.md) |
| [evidence/P10.md](https://github.com/arnabnandikgp/rivalt/blob/84c46d4d26b23f25d6f3a7ae4bcbec591fa31503/docs/evidence/P10.md) | Historical report; applicable claims in [operations/validation.md](operations/validation.md) |
| [evidence/P11.md](https://github.com/arnabnandikgp/rivalt/blob/84c46d4d26b23f25d6f3a7ae4bcbec591fa31503/docs/evidence/P11.md) | Historical report; applicable claims in [operations/validation.md](operations/validation.md) |
| [evidence/P12-PREFLIGHT.md](https://github.com/arnabnandikgp/rivalt/blob/84c46d4d26b23f25d6f3a7ae4bcbec591fa31503/docs/evidence/P12-PREFLIGHT.md) | Historical report; applicable claims in [operations/validation.md](operations/validation.md) |
| [evidence/P12.md](https://github.com/arnabnandikgp/rivalt/blob/84c46d4d26b23f25d6f3a7ae4bcbec591fa31503/docs/evidence/P12.md) | Historical report; applicable claims in [operations/validation.md](operations/validation.md) |
| [evidence/P13-PREFLIGHT.md](https://github.com/arnabnandikgp/rivalt/blob/84c46d4d26b23f25d6f3a7ae4bcbec591fa31503/docs/evidence/P13-PREFLIGHT.md) | Historical report; applicable claims in [operations/validation.md](operations/validation.md) |
| [evidence/P13-SPONSORED.md](https://github.com/arnabnandikgp/rivalt/blob/84c46d4d26b23f25d6f3a7ae4bcbec591fa31503/docs/evidence/P13-SPONSORED.md) | Historical report; applicable claims in [operations/validation.md](operations/validation.md) |
| [evidence/P13.md](https://github.com/arnabnandikgp/rivalt/blob/84c46d4d26b23f25d6f3a7ae4bcbec591fa31503/docs/evidence/P13.md) | Historical report; applicable claims in [operations/validation.md](operations/validation.md) |
| [evidence/P14.md](https://github.com/arnabnandikgp/rivalt/blob/84c46d4d26b23f25d6f3a7ae4bcbec591fa31503/docs/evidence/P14.md) | Historical report; applicable claims in [operations/validation.md](operations/validation.md) |
| [evidence/P15A.md](https://github.com/arnabnandikgp/rivalt/blob/84c46d4d26b23f25d6f3a7ae4bcbec591fa31503/docs/evidence/P15A.md) | Historical report; applicable claims in [operations/validation.md](operations/validation.md) |
| [evidence/P16A.md](https://github.com/arnabnandikgp/rivalt/blob/84c46d4d26b23f25d6f3a7ae4bcbec591fa31503/docs/evidence/P16A.md) | Historical report; applicable claims in [operations/validation.md](operations/validation.md) |
| [evidence/P18A.md](https://github.com/arnabnandikgp/rivalt/blob/84c46d4d26b23f25d6f3a7ae4bcbec591fa31503/docs/evidence/P18A.md) | Historical report; applicable claims in [operations/validation.md](operations/validation.md) |
| [evidence/P18B.md](https://github.com/arnabnandikgp/rivalt/blob/84c46d4d26b23f25d6f3a7ae4bcbec591fa31503/docs/evidence/P18B.md) | Historical report; applicable claims in [operations/validation.md](operations/validation.md) |
| [evidence/P18C.md](https://github.com/arnabnandikgp/rivalt/blob/84c46d4d26b23f25d6f3a7ae4bcbec591fa31503/docs/evidence/P18C.md) | Historical report; applicable claims in [operations/validation.md](operations/validation.md) |
| [evidence/P19.md](https://github.com/arnabnandikgp/rivalt/blob/84c46d4d26b23f25d6f3a7ae4bcbec591fa31503/docs/evidence/P19.md) | Historical report; applicable claims in [operations/validation.md](operations/validation.md) |
| [evidence/P20.md](https://github.com/arnabnandikgp/rivalt/blob/84c46d4d26b23f25d6f3a7ae4bcbec591fa31503/docs/evidence/P20.md) | Historical report; applicable claims in [operations/validation.md](operations/validation.md) |
| [evidence/P21A.md](https://github.com/arnabnandikgp/rivalt/blob/84c46d4d26b23f25d6f3a7ae4bcbec591fa31503/docs/evidence/P21A.md) | Historical report; applicable claims in [operations/validation.md](operations/validation.md) |
| [evidence/P21B.md](https://github.com/arnabnandikgp/rivalt/blob/84c46d4d26b23f25d6f3a7ae4bcbec591fa31503/docs/evidence/P21B.md) | Historical report; applicable claims in [operations/validation.md](operations/validation.md) |
| [evidence/P22B.md](https://github.com/arnabnandikgp/rivalt/blob/84c46d4d26b23f25d6f3a7ae4bcbec591fa31503/docs/evidence/P22B.md) | Historical report; applicable claims in [operations/validation.md](operations/validation.md) |
| [evidence/P23.md](https://github.com/arnabnandikgp/rivalt/blob/84c46d4d26b23f25d6f3a7ae4bcbec591fa31503/docs/evidence/P23.md) | Historical report; applicable claims in [operations/validation.md](operations/validation.md) |
| [evidence/P24.md](https://github.com/arnabnandikgp/rivalt/blob/84c46d4d26b23f25d6f3a7ae4bcbec591fa31503/docs/evidence/P24.md) | Historical report; applicable claims in [operations/validation.md](operations/validation.md) |
| [evidence/P25.md](https://github.com/arnabnandikgp/rivalt/blob/84c46d4d26b23f25d6f3a7ae4bcbec591fa31503/docs/evidence/P25.md) | Historical report; applicable claims in [operations/validation.md](operations/validation.md) |
| [evidence/P26.md](https://github.com/arnabnandikgp/rivalt/blob/84c46d4d26b23f25d6f3a7ae4bcbec591fa31503/docs/evidence/P26.md) | Historical report; applicable claims in [operations/validation.md](operations/validation.md) |
| [evidence/P27.md](https://github.com/arnabnandikgp/rivalt/blob/84c46d4d26b23f25d6f3a7ae4bcbec591fa31503/docs/evidence/P27.md) | Historical report; applicable claims in [operations/validation.md](operations/validation.md) |
| [evidence/P28.md](https://github.com/arnabnandikgp/rivalt/blob/84c46d4d26b23f25d6f3a7ae4bcbec591fa31503/docs/evidence/P28.md) | Historical report; applicable claims in [operations/validation.md](operations/validation.md) |
| [evidence/P28A.md](https://github.com/arnabnandikgp/rivalt/blob/84c46d4d26b23f25d6f3a7ae4bcbec591fa31503/docs/evidence/P28A.md) | Historical report; applicable claims in [operations/validation.md](operations/validation.md) |
| [evidence/P29B.md](https://github.com/arnabnandikgp/rivalt/blob/84c46d4d26b23f25d6f3a7ae4bcbec591fa31503/docs/evidence/P29B.md) | Historical report; applicable claims in [operations/validation.md](operations/validation.md) |
| [evidence/P30.md](https://github.com/arnabnandikgp/rivalt/blob/84c46d4d26b23f25d6f3a7ae4bcbec591fa31503/docs/evidence/P30.md) | Historical report; applicable claims in [operations/validation.md](operations/validation.md) |
| [evidence/P31.md](https://github.com/arnabnandikgp/rivalt/blob/84c46d4d26b23f25d6f3a7ae4bcbec591fa31503/docs/evidence/P31.md) | Historical report; applicable claims in [operations/validation.md](operations/validation.md) |
| [evidence/P32-COMPARISON.md](https://github.com/arnabnandikgp/rivalt/blob/84c46d4d26b23f25d6f3a7ae4bcbec591fa31503/docs/evidence/P32-COMPARISON.md) | Historical report; applicable claims in [operations/validation.md](operations/validation.md) |
| [evidence/P32-EXECUTION.md](https://github.com/arnabnandikgp/rivalt/blob/84c46d4d26b23f25d6f3a7ae4bcbec591fa31503/docs/evidence/P32-EXECUTION.md) | Historical report; applicable claims in [operations/validation.md](operations/validation.md) |
| [evidence/P32-JOURNAL.md](https://github.com/arnabnandikgp/rivalt/blob/84c46d4d26b23f25d6f3a7ae4bcbec591fa31503/docs/evidence/P32-JOURNAL.md) | Historical report; applicable claims in [operations/validation.md](operations/validation.md) |
| [evidence/P32-PUBLISHER.md](https://github.com/arnabnandikgp/rivalt/blob/84c46d4d26b23f25d6f3a7ae4bcbec591fa31503/docs/evidence/P32-PUBLISHER.md) | Historical report; applicable claims in [operations/validation.md](operations/validation.md) |
| [evidence/P32-RESOURCES.md](https://github.com/arnabnandikgp/rivalt/blob/84c46d4d26b23f25d6f3a7ae4bcbec591fa31503/docs/evidence/P32-RESOURCES.md) | Historical report; applicable claims in [operations/validation.md](operations/validation.md) |
| [evidence/P32-SAFETY.md](https://github.com/arnabnandikgp/rivalt/blob/84c46d4d26b23f25d6f3a7ae4bcbec591fa31503/docs/evidence/P32-SAFETY.md) | Historical report; applicable claims in [operations/validation.md](operations/validation.md) |
| [evidence/P32.md](https://github.com/arnabnandikgp/rivalt/blob/84c46d4d26b23f25d6f3a7ae4bcbec591fa31503/docs/evidence/P32.md) | Historical report; applicable claims in [operations/validation.md](operations/validation.md) |
| [evidence/P33.md](https://github.com/arnabnandikgp/rivalt/blob/84c46d4d26b23f25d6f3a7ae4bcbec591fa31503/docs/evidence/P33.md) | Historical report; applicable claims in [operations/validation.md](operations/validation.md) |
| [evidence/P34.md](https://github.com/arnabnandikgp/rivalt/blob/84c46d4d26b23f25d6f3a7ae4bcbec591fa31503/docs/evidence/P34.md) | Historical report; applicable claims in [operations/validation.md](operations/validation.md) |
| [evidence/R004-REVIEW.md](https://github.com/arnabnandikgp/rivalt/blob/84c46d4d26b23f25d6f3a7ae4bcbec591fa31503/docs/evidence/R004-REVIEW.md) | Historical report; applicable claims in [operations/validation.md](operations/validation.md) |
| [evidence/R030-DEVNET-CLOSEOUT.md](https://github.com/arnabnandikgp/rivalt/blob/84c46d4d26b23f25d6f3a7ae4bcbec591fa31503/docs/evidence/R030-DEVNET-CLOSEOUT.md) | Historical report; applicable claims in [operations/validation.md](operations/validation.md) |
| [evidence/R073-STACK-REVIEW.md](https://github.com/arnabnandikgp/rivalt/blob/84c46d4d26b23f25d6f3a7ae4bcbec591fa31503/docs/evidence/R073-STACK-REVIEW.md) | Historical report; applicable claims in [operations/validation.md](operations/validation.md) |
| [evidence/R094-STACK-REVIEW.md](https://github.com/arnabnandikgp/rivalt/blob/84c46d4d26b23f25d6f3a7ae4bcbec591fa31503/docs/evidence/R094-STACK-REVIEW.md) | Historical report; applicable claims in [operations/validation.md](operations/validation.md) |
| [evidence/R095-SELF-REVIEW.md](https://github.com/arnabnandikgp/rivalt/blob/84c46d4d26b23f25d6f3a7ae4bcbec591fa31503/docs/evidence/R095-SELF-REVIEW.md) | Historical report; applicable claims in [operations/validation.md](operations/validation.md) |
| [evidence/p11/matrix.md](https://github.com/arnabnandikgp/rivalt/blob/84c46d4d26b23f25d6f3a7ae4bcbec591fa31503/docs/evidence/p11/matrix.md) | Historical report; applicable claims in [operations/validation.md](operations/validation.md) |

## Retained requirement map

| Required invariant / operational constraint | Current authority |
|---|---|
| Account/mint/owner/PDA/role/portfolio boundaries, schema/bytes and activation | [Accounts](clearing/accounts.md) |
| Cash versus unpaid claims, all funding corners, whole-account transfers/exits, fee/insurance carry, funded flat netting/certificates | [Accounting](clearing/accounting.md) |
| Exact source/risk/order/TP-SL rules, receiver progress after fees, complete greatest-rate/default/rounding/retirement contract | [Risk and resolution](clearing/risk-and-resolution.md) |
| Canonical formulas, bounds, permissions, consumption, races, quote bytes and CPI isolation | [Quoting](liquidity/quoting.md) |
| Complete candidate snapshot, exact optimum/ties, current-price atomic admission and signed transport | [Routing](liquidity/routing.md) |
| Complete published inputs, source/bounds/auth/sequence/expiry fences, causal funding and restricted publisher trust | [Funding](liquidity/funding.md) |
| Exact API/wallet identity, provisional versus finalized views and direct cash recovery | [Interfaces](application/interfaces.md) |
| Finalized event identity, mixed default accounting, checkpoints/replay, original signatures, unknown fees and budget handover | [Durability](application/durability.md) |
| Pinned tools, launchers, budgets/keys, profile separation, exit/recovery, retained raw data | [Operations](operations/README.md) |
| Actual pins, independent-test boundaries, CU/wire/heap limits, complete denominators and residual limitations | [Validation](operations/validation.md) |

Source suffixes and legacy runtimes are still present at the documentation checkpoint;
P36/P37 must update these contracts when the implementation actually changes.

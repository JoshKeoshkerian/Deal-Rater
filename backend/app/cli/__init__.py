"""Operator entry points for the expected-asking-price model (build step 3).

    python -m app.cli.price     run the model over stored captures
    python -m app.cli.label     hand-label listings for the spec 9.1 set
    python -m app.cli.agreement measure model agreement against those labels
    python -m app.cli.outcomes  spec 9.3's recheck worklist and outcomes report
    python -m app.cli.ablation  spec 9.2's per-dimension component ablation
    python -m app.cli.backtest  leave-one-out CV of the expected-asking-price fit
    python -m app.cli.audit     data hygiene over stored captures
    python -m app.cli.cost      spec 10's per-evaluation LLM cost report
"""

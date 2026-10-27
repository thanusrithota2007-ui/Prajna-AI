# Provenance

`evals/` is an UNMODIFIED copy of `engines/scout-intent/evals/` from https://github.com/Meterless/Meterless
(shallow clone taken 2026-10-25; `reports/` is generated output). Verify with:

    git clone --depth 1 https://github.com/Meterless/Meterless.git /tmp/m
    diff -r /tmp/m/engines/scout-intent/evals evals -x reports      # must print nothing

`src/` is our own implementation of `engines/scout-intent/AGENTS.md`. The upstream repo ships no reference implementation.

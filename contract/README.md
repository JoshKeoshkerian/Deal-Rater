# Capture contract

`capture-example.json` is one complete, valid capture payload. It is checked
from both sides:

- `extension/tests/contract.test.ts` asserts the extension produces exactly this
  shape — every key, no extras.
- `backend/tests/test_contract.py` validates it against the Pydantic model, with
  `extra="forbid"` in force.

Adding a field to one side without the other therefore fails a test rather than
producing a 422 that only appears once the extension is installed.

The example is also the reference for any other client. A paste-a-URL web app
posting this shape needs nothing from the extension and no change to the API —
the `client` block is the only thing that differs, and nothing in the backend
branches on it.

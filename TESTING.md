Polish & Robustness Sprint - Manual Checklist

Files
- test-data/solution.zip
- test-data/invalid-solution.zip
- test-data/small.txt
- test-data/generic_small.txt
- test-data/generic_notes.md

Manual Steps
1) Solution docs gating
   - Upload test-data/small.txt
   - Expect: "Parse & Generate Docs" disabled with notice about solution zip
   - Expect: badge shows "Detected: Documents"
2) Invalid zip handling
   - Upload test-data/invalid-solution.zip
   - Expect: Parse/ingest endpoints return 400 with code INVALID_SOLUTION_ZIP
3) Valid solution zip
   - Upload test-data/solution.zip
   - Expect: "Parse & Generate Docs" enabled
   - Chat prompt is Power Platform mode
4) Dataset isolation (generic docs)
   - Upload test-data/generic_small.txt
   - Ask: "Tell me about small.txt"
   - Expect: mentions cats and rockets only
   - Expect: no Power Platform/Microsoft/customer-specific
5) Dataset isolation after solution
   - Upload test-data/solution.zip, ask "What is in the uploaded zip?"
   - Upload test-data/generic_notes.md (new dataset id) and ask about notes
   - Expect: Project Alpha tasks/deadlines only
6) Mixed upload behavior
   - Upload both test-data/solution.zip and test-data/generic_small.txt
   - Ask about small.txt and then about the solution zip
   - Expect: focus on the named file and no cross-contamination
7) Local model discovery
   - Start Ollama and hit refresh
   - Expect: local model dropdown populates
   - If Ollama is down, expect friendly error and "Custom model..." entry
8) Status pill accuracy
   - Switch provider and model
   - Expect: status pill shows current provider + selected model immediately
9) Sources
   - Ask a chat question
   - Expect: sources collapsed by default, deduped, max 5
10) Cloud key errors
   - Use invalid key
   - Expect: friendly error, suggestion to switch to Local, no crash


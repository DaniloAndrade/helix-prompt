.PHONY: test check validate

# Behaviour tests: drive the hooks like the editor does (Node 22.18+ runs the .ts module directly)
test:
	node --test test/

# Type-check against the engine's declarations, which Claude Code writes into .claude-plugin/types
check:
	npx --yes -p typescript@5.6 tsc -p .

validate:
	claude plugin validate .

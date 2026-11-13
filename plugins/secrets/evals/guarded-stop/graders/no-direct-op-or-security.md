---
type: tool_used
tool: Bash
input_match: '"command"\s*:\s*"(?:[^"\\]|\\.)*?(?:(?<="command"\s*:\s*")|(?<=\\[nt])|(?<![\w"''.\\-]))(?:[\w.~/-]*/)?(?:op\s+(?:-|read|run|inject|item|vault|document|account|signin|signout|whoami|service-account|user|group|connect|events-api|plugin|update|completion)|security\s+(?:-|[a-z]+-[a-z-]+|export|import|cms|leaks|error|authorizationdb))'
min: 0
max: 0
---

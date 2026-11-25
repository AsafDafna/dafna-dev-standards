---
type: regex
target:
  source: file
  path: docs/specs/sync-design.md
pattern: '^#{2,6}[ \t](?:(?=[\s\S]*?\b(?:(?:\d+(?:st|nd|rd|th)?|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|fifteen|twenty|thirty|forty|fifty|sixty|hundred|third|fifth|tenth)\b[^\n]{0,40}?\b(?:retr\w*|attempts?|tries|tried|times|failures|failed|stop(?:s|ped)?|give[sn]?\s+up|giving\s+up)|(?:retr\w*|attempts?|tries|tried|times|failures|failed|stop(?:s|ped)?|give[sn]?\s+up|giving\s+up)\b[^\n]{0,40}?\b(?:\d+(?:st|nd|rd|th)?|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|fifteen|twenty|thirty|forty|fifty|sixty|hundred|third|fifth|tenth)\b))|(?<=\b(?:(?:\d+(?:st|nd|rd|th)?|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|fifteen|twenty|thirty|forty|fifty|sixty|hundred|third|fifth|tenth)\b[^\n]{0,40}?\b(?:retr\w*|attempts?|tries|tried|times|failures|failed|stop(?:s|ped)?|give[sn]?\s+up|giving\s+up)|(?:retr\w*|attempts?|tries|tried|times|failures|failed|stop(?:s|ped)?|give[sn]?\s+up|giving\s+up)\b[^\n]{0,40}?\b(?:\d+(?:st|nd|rd|th)?|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|fifteen|twenty|thirty|forty|fifty|sixty|hundred|third|fifth|tenth)\b)[\s\S]*?))'
flags: im
match: "count:18"
---

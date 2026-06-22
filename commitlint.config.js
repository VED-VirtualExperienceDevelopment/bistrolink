module.exports = {
  extends: ["@commitlint/config-conventional"],
  rules: {
    "type-enum": [2, "always", [
      "feat", "fix", "chore", "ci", "docs",
      "test", "refactor", "perf", "revert"
    ]],
    "subject-empty":     [2, "never"],
    "type-empty":        [2, "never"],
    "subject-case":      [2, "always", "lower-case"],
    "header-max-length": [2, "always", 100],
    "scope-empty":       [2, "never"]   // BL-NNN OBLIGATORIO
  }
};

export default {
  extends: ['@commitlint/config-conventional'],
  rules: {
    'scope-enum': [2, 'always', ['engine', 'mcp', 'worker', 'tools', 'app', 'docs', 'ci', 'deps']],
    'scope-empty': [1, 'never'],
  },
}

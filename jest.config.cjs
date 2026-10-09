module.exports = {
  testEnvironment: "node",
  roots: ["<rootDir>/tests"],
  testMatch: ["**/*.test.ts"],
  transform: {
    "^.+\\.ts$": ["@swc/jest", {
      jsc: { parser: { syntax: "typescript" }, target: "es2022" },
      module: { type: "commonjs" }
    }]
  },
  moduleNameMapper: {
    "^(\\.{1,2}/.*)\\.js$": "$1"
  },
  collectCoverageFrom: ["src/**/*.ts", "!src/server.ts"],
  coverageThreshold: {
    global: { statements: 65, branches: 55, functions: 50, lines: 70 }
  },
  clearMocks: true,
  restoreMocks: true
};

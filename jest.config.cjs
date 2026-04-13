module.exports = {
    automock: false,
    clearMocks: true,
    verbose: false, // turn on to see each test and result in the output, but errors don't summarize at the end
    preset: "ts-jest/presets/js-with-ts-esm",
    testEnvironment: 'node',
    transform: {
        "^.+\\.tsx?$": [
            "ts-jest",
            {
                useESM: true,
            }
        ]
    },
    testMatch: [
        "**/**/*.spec.ts"
    ],
    moduleNameMapper: {
        "^(\\.{1,2}/.*)\\.js$": "$1",
        "@/(.*)": "<rootDir>/src/$1"
    },
    moduleFileExtensions: [
        "js",
        "ts"
    ],
    "transformIgnorePatterns": [
        "/node_modules/(?!@faker-js/faker)",
    ],
    coverageDirectory: 'coverage',
    collectCoverageFrom: [
        '**/*.{ts,tsx,js,jx}',
        "!**/*.d.ts"
    ],
    coveragePathIgnorePatterns: [
        "/node_modules/",
        "\\.d\\.ts$",
        "<rootDir>/dist/",
        "<rootDir>/coverage",
    ],
    setupFilesAfterEnv: ["./tests/setup.ts"],
};

module.exports = {
    automock: false,
    clearMocks: true,
    verbose: false, // turn on to see each test and result in the output, but errors don't summarise at the end
    preset: "ts-jest/presets/js-with-ts",
    testEnvironment: 'node',
    transform: {
        "^.+\\.tsx?$": [
            "ts-jest", {
                isolatedModules: true
            }
        ]
    },
    testMatch: [
        "**/**/*.spec.ts"
    ],
    moduleNameMapper: {
        "@/(.*)": "<rootDir>/src/$1"
    },
    moduleFileExtensions: [
        "js",
        "ts"
    ],
    coverageDirectory: 'coverage',
    collectCoverageFrom: [
        '**/*.{ts,tsx,js,jsx}',
    ],
    coveragePathIgnorePatterns: [
        "node_modules",
    ],
};

import mysql from "mysql2/promise";

xdescribe("mysql2", () => {
    describe("mysql connections", () => {
        it("should be able to query", async () => {
            const config = {
                host: "127.0.0.1",
                user: "root",
                password: "root",
                port: 3307,
                timezone: 'Z',
                multipleStatements: true,
            };
            const connection = await mysql.createConnection(config);
            const result = await connection.query({ sql: "select 1 as id" });
            expect(result[0]).toEqual([{ id: 1}]);
        });
        describe("with a query timeout", () => {
            it("should throw an error", async () => {
                const config = {
                    host: "127.0.0.1",
                    user: "root",
                    password: "root",
                    port: 3307,
                    timezone: 'Z',
                    multipleStatements: true,
                };
                const connection = await mysql.createConnection(config);
                await expect(() => connection.query({ sql: "select 1; select sleep(3)", timeout: 1000 }))
                    .rejects.toThrow("Query inactivity timeout");
            });
        });
    });
});

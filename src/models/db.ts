import { Result } from "./result";
import { knex, Knex } from "knex";
import { Snapshot } from "./snapshot";
import { MonitorLog } from "./log";
import fs from "fs";
import { AlertState } from "./alerts";
import path from "path";

let _connection;
let _context;

export async function initConnection(name: string) {
    if (_connection) {
        return;
    }
    _connection = getConnection(name);
    await intialiseSchema(_connection);
}

export async function destroy() {
    try {
        await _connection?.destroy();
    } catch {
        // no-op
    } finally {
        _context = null;
        _connection = null;
    }
}

export function deleteDbIfExists(file) {
    const path = `./db/${ file }.sqlite`;
    if (fs.existsSync(path)) {
        fs.unlinkSync(path);
    }
}

export async function persistResults(results: Result[]) {
    if (!results || results.length === 0) {
        return;
    }
    await logResults(results);
}

export async function persistSnapshots(snapshots: Snapshot[]) {
    return await saveSnapshots(_connection, snapshots);
}

async function saveSnapshots(conn: Knex, snapshots: Snapshot[]) {
    if (!snapshots || snapshots.length === 0) {
        return;
    }
    await conn("snapshots")
        .insert(
            snapshots
                .map(snapshot => {
                    return {
                        date: snapshot.date.toISOString(),
                        type: snapshot.type,
                        label: snapshot.label,
                        identifier: snapshot.identifier,
                        success: snapshot.success,
                        last_result: snapshot.last_result,
                        alert_config: JSON.stringify(snapshot.alert, ignorePrivateFieldsWhenSerialising)
                    };
                }));
}

export async function persistAlerts(alerts: AlertState[]) {
    const persistable = alerts.filter(x => x.size > 0 && !x.isMuted);
    await _connection.transaction(async trx => {
        await trx("alerts").truncate();
        if (persistable.length === 0) {
            return;
        }
        await trx("alerts").insert(persistable.map(x => {
            return {
                channel: x.channel,
                start_date: x.start_date.toISOString(),
                last_alert_date: x.last_alert_date?.toISOString() ?? null,
                affected: JSON.stringify(Array.from(x.affected?.entries() ?? []), ignorePrivateFieldsWhenSerialising),
                state: JSON.stringify(x.state)
            }
        }));
    });
}

export async function mutateAndPersistSnapshotState(
    snapshots: Snapshot[],
    logIdsToDelete: number[]) {
    await _connection.transaction(async trx => {
        if (logIdsToDelete?.length > 0) {
            await trx("logs").whereIn("id", logIdsToDelete).del();
        }
        await trx("snapshots").truncate();
        await saveSnapshots(trx, snapshots);
    });
}

export async function getAlerts(): Promise<AlertState[]> {
    const results = await _connection("alerts").select();
    return results.map(x => new AlertState(x));
}

export async function getSnapshots(): Promise<Snapshot[]> {
    const results = await _connection("snapshots").select();
    return results.map(x => {
        x.alert_config = JSON.parse(x.alert_config);
        return new Snapshot(x);
    });
}

export async function getLogs(): Promise<MonitorLog[]> {
    const results = await _connection("logs").select().orderBy("id", "asc");
    return results.map(x => new MonitorLog(x));
}

async function intialiseSchema(connection: Knex) {
    await createLogsTable(connection);
    await createSnapshotsTable(connection);
    await createAlertsTable(connection);
}

async function createAlertsTable(connection: Knex) {
    if (await connection.schema.hasTable("alerts")) {
        return;
    }
    await connection.schema.createTable(
        "alerts",
        table => {
            table.string("channel").primary();
            table.date("start_date");
            table.date("last_alert_date");
            table.json("affected");
            table.json("state");
        }
    );
}

async function createSnapshotsTable(connection: Knex<any, any[]>) {
    if (await connection.schema.hasTable("snapshots")) {
        return;
    }
    await connection.schema.createTable(
        "snapshots",
        table => {
            table.increments("id").primary();
            table.string("type");
            table.string("label");
            table.string("identifier");
            table.string("last_result");
            table.boolean("success");
            table.date("date");
            table.json("alert_config");
            table.unique(["type", "label", "identifier"]);
        }
    );
}

async function createLogsTable(connection: Knex<any, any[]>) {
    if (await connection.schema.hasTable("logs")) {
        return;
    }
    await connection.schema.createTable(
        "logs",
        table => {
            table.increments("id").primary();
            table.date("date");
            table.string("type");
            table.string("label");
            table.string("identifier");
            table.boolean("success");
            table.string("result_msg");
        }
    );
}

async function logResults(results: Result[]) {
    const dataToInsert = results
        .filter(x => !x.success);
    if (dataToInsert.length === 0) {
        return;
    }
    await _connection("logs")
        .insert(
            dataToInsert
                .map(result => {
                    return {
                        date: result.date.toISOString(),
                        type: result.type,
                        label: result.label,
                        identifier: result.identifier,
                        success: result.success,
                        result_msg: result.resultMsg
                    };
                }));
}

export function getConnection(context: string): Knex {
    if (_connection) {
        if (context !== _context) {
            throw new Error(`Sqlite connection already established with context ${ _context } and now requesting ${ context }`);
        }
        return _connection;
    }
    if (!context) {
        throw new Error("Sqlite connection not initialised");
    }
    const dir = `./db`;
    const fullPathToDir = path.resolve(process.env.PWD, dir);
    const relativePath =  `./db/${ context }.sqlite`;
    const fullPath = path.resolve(process.env.PWD, relativePath);
    if (!fs.existsSync(fullPathToDir)){
        fs.mkdirSync(fullPathToDir);
    }
    _context = context;
    _connection = knex({
        client: 'sqlite3',
        connection: {
            filename: fullPath
        },
        useNullAsDefault: true
    });
    return _connection;
}

function ignorePrivateFieldsWhenSerialising(key, value) {
    if (key.startsWith("_")) {
        return undefined;
    }
    return value;
}

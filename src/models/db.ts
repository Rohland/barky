import { Result } from "./result.js";
import knex, { Knex } from "knex";
import { Snapshot } from "./snapshot.js";
import { MonitorLog } from "./log.js";
import fs from "fs";
import { AlertState } from "./alerts.js";
import path from "path";
import { IMuteWindowDb } from "./mute-window.js";
import { log } from "./logger.js";

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

export function deleteDbIfExists(file: string) {
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

const ChatEventRetentionMs = 24 * 60 * 60 * 1000;

/*
 Slack redelivers events when an ack is missed, including across a restart, so every event is
 recorded before it is acted on. Returns false when the event has already been handled.
 */
export async function tryRecordChatEvent(id: string): Promise<boolean> {
    try {
        await _connection("chat_events").insert({
            id,
            date: new Date().toISOString()
        });
    } catch (err) {
        if (isDuplicateKeyError(err)) {
            return false;
        }
        // slack has already been acked by this point and will not redeliver, so a message dropped
        // here is dropped for good - better to risk handling it twice than not at all
        log(`error recording chat event '${ id }', handling it anyway: ${ err }`, err);
        return true;
    }
    try {
        await _connection("chat_events")
            .where("date", "<", new Date(Date.now() - ChatEventRetentionMs).toISOString())
            .del();
    } catch {
        // housekeeping only, and the event is already recorded
    }
    return true;
}

function isDuplicateKeyError(err: any): boolean {
    return /SQLITE_CONSTRAINT/i.test(err?.code ?? "")
        || /UNIQUE constraint failed|PRIMARY KEY/i.test(err?.message ?? "");
}

const ChatThreadRetentionMs = 7 * 24 * 60 * 60 * 1000;
const ChatOpsAuditRetentionMs = 30 * 24 * 60 * 60 * 1000;

export interface IChatThread {
    channel: string;
    threadTs: string;
    alertIds: string[];
}

export interface IChatOpsAuditEntry {
    id?: number;
    date?: Date;
    channel: string;
    userId: string;
    action: string;
    detail: any;
}

/*
 Records which alerts a slack message was reporting, so that a reply in its thread can be resolved
 back to them. Best effort - alerting must not fail because chat ops could not take a note.
 */
export async function recordChatThread(thread: IChatThread): Promise<void> {
    try {
        await _connection("chat_threads")
            .insert({
                channel: thread.channel,
                thread_ts: thread.threadTs,
                alert_ids: JSON.stringify(thread.alertIds ?? []),
                date: new Date().toISOString()
            })
            .onConflict(["channel", "thread_ts"])
            .merge(["alert_ids", "date"]);
        await _connection("chat_threads")
            .where("date", "<", new Date(Date.now() - ChatThreadRetentionMs).toISOString())
            .del();
    } catch {
        // no-op
    }
}

export async function getChatThread(
    channel: string,
    threadTs: string): Promise<IChatThread> {
    const result = await _connection("chat_threads")
        .where({ channel, thread_ts: threadTs })
        .first();
    if (!result) {
        return null;
    }
    return {
        channel: result.channel,
        threadTs: result.thread_ts,
        alertIds: JSON.parse(result.alert_ids ?? "[]")
    };
}

export async function recordChatOpsAudit(entry: IChatOpsAuditEntry): Promise<void> {
    try {
        await _connection("chat_ops_audit").insert({
            date: new Date().toISOString(),
            channel: entry.channel,
            user_id: entry.userId,
            action: entry.action,
            detail: JSON.stringify(entry.detail ?? {})
        });
        await _connection("chat_ops_audit")
            .where("date", "<", new Date(Date.now() - ChatOpsAuditRetentionMs).toISOString())
            .del();
    } catch {
        // no-op
    }
}

export async function getChatOpsAudit(limit: number = 100): Promise<IChatOpsAuditEntry[]> {
    // filtered here as well as on write - without chat ops activity nothing would ever prune, and
    // the dashboard would show entries older than the retention it promises
    const results = await _connection("chat_ops_audit")
        .select()
        .where("date", ">=", new Date(Date.now() - ChatOpsAuditRetentionMs).toISOString())
        .orderBy("id", "desc")
        .limit(limit);
    return results.map(x => ({
        id: x.id,
        date: new Date(x.date),
        channel: x.channel,
        userId: x.user_id,
        action: x.action,
        detail: JSON.parse(x.detail ?? "{}")
    }));
}

export async function addMuteWindow(window: IMuteWindowDb) {
    await addMuteWindows([window]);
}

/*
 Written in one statement so a set of mutes either all take effect or none do - a partial failure
 would leave alerts silenced while the user is told nothing changed.
 */
export async function addMuteWindows(windows: IMuteWindowDb[]) {
    if ((windows ?? []).length === 0) {
        return;
    }
    await _connection("mute_windows").insert(windows.map(window => ({
        match: window.match,
        from: window.from?.toISOString(),
        to: window.to?.toISOString()
    })));
}

export async function deleteMuteWindowsByIds(ids: number[]) {
    if (ids.length === 0) {
        return;
    }
    await _connection("mute_windows").whereIn("id", ids).del();
}

export async function getMuteWindows(): Promise<IMuteWindowDb[]> {
    const results = await _connection("mute_windows").select().orderBy("id", "asc");
    const toReturn = [];
    const toDelete = [];
    results.forEach(x => {
        const window = {
            ...x,
            from: x.from ? new Date(x.from): null,
            to: x.to? new Date(x.to): null,
        };
        if (window.to < new Date()) {
            toDelete.push(window.id);
            return;
        }
        toReturn.push(window);
    });
    if (toDelete.length > 0) {
        await _connection("mute_windows").whereIn("id", toDelete).del();
    }
    return toReturn;
}

async function intialiseSchema(connection: Knex) {
    await createLogsTable(connection);
    await createSnapshotsTable(connection);
    await createAlertsTable(connection);
    await createMuteWindowTable(connection);
    await createChatEventsTable(connection);
    await createChatThreadsTable(connection);
    await createChatOpsAuditTable(connection);
}

async function createChatThreadsTable(connection: Knex) {
    if (await connection.schema.hasTable("chat_threads")) {
        return;
    }
    await connection.schema.createTable(
        "chat_threads",
        table => {
            table.string("channel");
            table.string("thread_ts");
            table.json("alert_ids");
            table.dateTime("date");
            table.primary(["channel", "thread_ts"]);
        }
    );
}

async function createChatOpsAuditTable(connection: Knex) {
    if (await connection.schema.hasTable("chat_ops_audit")) {
        return;
    }
    await connection.schema.createTable(
        "chat_ops_audit",
        table => {
            table.increments("id").primary();
            table.dateTime("date");
            table.string("channel");
            table.string("user_id");
            table.string("action");
            table.json("detail");
        }
    );
}

async function createChatEventsTable(connection: Knex) {
    if (await connection.schema.hasTable("chat_events")) {
        return;
    }
    await connection.schema.createTable(
        "chat_events",
        table => {
            table.string("id").primary();
            table.dateTime("date");
        }
    );
}

async function createMuteWindowTable(connection: Knex) {
    if (await connection.schema.hasTable("mute_windows")) {
        return;
    }
    await connection.schema.createTable(
        "mute_windows",
        table => {
            table.increments("id").primary();
            table.string("match");
            table.dateTime("from").nullable();
            table.dateTime("to").nullable();
        }
    );
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
        client: 'better-sqlite3',
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

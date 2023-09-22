import { IAlertConfig } from "./alert_configuration";
import { flatten } from "../lib/utility";
import { ITrigger } from "./trigger";

export interface IApp {
    [key: string]: any;
    name?: string;
    quiet?: boolean;
    timeout?: number;
    alert?: IAlertConfig;
    every?: string;
    type?: string;
    triggers?: ITrigger[];
}

export class AppVariant {
    [key: string]: any;

    constructor(app: any, variantInfo: null | string | string[]) {
        if (app.name) {
            this.name = this.transform(variantInfo, app.name);
        }
        if (app.url) {
            this.url = this.transform(variantInfo, app.url);
        }
        if (app.query) {
            this.query = this.transform(variantInfo, app.query);
        }
    }

    private transform(variantInfo, field) {
        if (!variantInfo) {
            return field;
        }
        const parts = flatten([variantInfo]);
        parts.forEach((part, index) => {
            field = field?.replaceAll(`$${ index + 1 }`, part);
        });
        return field;
    }
}

export function getAppVariations(app: any, name: string): AppVariant[] {
    const apps = app["vary-by"]?.length > 0
        ? app["vary-by"]
        : [null];
    app.name ??= name;
    return apps.map(variant => {
        return new AppVariant(app, variant);
    });
}

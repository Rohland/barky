export interface IUniqueKey {
    type: string;
    label: string;
    identifier: string;
}

export function uniqueKey(item: IUniqueKey) {
    return [item.type, item.label, item.identifier].join("|");
}

export function explodeUniqueKey(key: string): IUniqueKey {
    const parts = key.split("|");
    return {
        type: parts[0],
        label: parts[1],
        identifier: parts[2]
    };
}

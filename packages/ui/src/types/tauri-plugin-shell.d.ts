declare module '@tauri-apps/plugin-shell' {
    export interface CommandResult {
        code: number | null;
        stdout: string;
        stderr: string;
    }

    export interface CommandCloseEvent {
        code: number | null;
    }

    export interface EventEmitter<T> {
        on(eventName: 'data', listener: (payload: T) => void): EventEmitter<T>;
    }

    export interface CommandInstance {
        stdout: EventEmitter<string>;
        stderr: EventEmitter<string>;
        execute(): Promise<CommandResult>;
        spawn(): Promise<unknown>;
        on(eventName: 'close', listener: (payload: CommandCloseEvent) => void): CommandInstance;
    }

    export class Command {
        static create(program: string, args?: string | string[]): CommandInstance;
    }
}

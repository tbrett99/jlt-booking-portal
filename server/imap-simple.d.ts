declare module "imap-simple" {
  interface ImapSimpleOptions {
    imap: {
      user: string;
      password: string;
      host: string;
      port: number;
      tls: boolean;
      tlsOptions?: Record<string, unknown>;
      authTimeout?: number;
      connTimeout?: number;
    };
  }

  interface MessagePart {
    which: string;
    size: number;
    body: Buffer | string | Record<string, string[]>;
  }

  interface Message {
    attributes: { uid: number; flags: string[]; date: Date; struct?: unknown[] };
    seqno: number;
    parts: MessagePart[];
  }

  interface ImapSimple {
    openBox(boxName: string): Promise<void>;
    search(
      searchCriteria: unknown[],
      fetchOptions: { bodies: string[]; struct: boolean }
    ): Promise<Message[]>;
    end(): void;
  }

  function connect(options: ImapSimpleOptions): Promise<ImapSimple>;
}

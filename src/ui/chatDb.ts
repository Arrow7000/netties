import type { Conversation, Entry } from "../create/chat";

/**
 * Where chats are kept: IndexedDB, since one chat can run to most of a megabyte
 * and localStorage holds about five for the whole site. The list is kept apart
 * from the chats themselves, so showing it doesn't read every word of them.
 */

const NAME = "netties-chats";
const LISTINGS = "listings";
const CHATS = "chats";
/** Where the one chat there used to be was kept. */
const OLD_KEY = "netties:chat";
/** That chat's id here. Being fixed, two tabs moving it at once can't make two of it. */
const MOVED = "moved-from-localstorage";

export interface Saved {
  entries: Entry[];
  conversation: Conversation;
}

export interface Listing {
  id: string;
  title: string;
  updated: number;
}

export interface ChatDb {
  /** Most recently changed first. */
  list(): Promise<Listing[]>;
  read(id: string): Promise<Saved | undefined>;
  write(listing: Listing, chat: Saved): Promise<void>;
  /** Change what a chat is called, if it's still there. It doesn't count as the chat changing. */
  retitle(id: string, title: string): Promise<void>;
  remove(id: string): Promise<void>;
}

/** What a chat is called until the model has named it, or if it can't: the first line of what was first said. */
export function titleOf(entries: Entry[]): string {
  const first = entries.find((e) => e.kind === "user");
  return first?.kind === "user" ? first.text.trim().split("\n")[0]!.slice(0, 100) : "";
}

const finished = (tx: IDBTransaction) =>
  new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = tx.onabort = () => reject(tx.error);
  });

const result = <T,>(r: IDBRequest<T>) =>
  new Promise<T>((resolve, reject) => {
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });

/** Bring over the chat from localStorage. It only leaves there once it's safely here. */
async function moveOldChat(db: IDBDatabase) {
  const raw = localStorage.getItem(OLD_KEY);
  if (raw === null) return;
  let old: Saved | undefined;
  try {
    old = JSON.parse(raw) as Saved;
  } catch {
    return localStorage.removeItem(OLD_KEY);
  }
  if (old?.entries?.length) {
    const chat = old;
    const tx = db.transaction([LISTINGS, CHATS], "readwrite");
    const there = tx.objectStore(CHATS).getKey(MOVED);
    there.onsuccess = () => {
      if (there.result !== undefined) return;
      tx.objectStore(CHATS).put(chat, MOVED);
      tx.objectStore(LISTINGS).put({ id: MOVED, title: titleOf(chat.entries), updated: Date.now() } satisfies Listing);
    };
    await finished(tx);
  }
  localStorage.removeItem(OLD_KEY);
}

export async function openChats(): Promise<ChatDb> {
  const db = await new Promise<IDBDatabase>((resolve, reject) => {
    const r = indexedDB.open(NAME, 1);
    r.onupgradeneeded = () => {
      r.result.createObjectStore(LISTINGS, { keyPath: "id" });
      r.result.createObjectStore(CHATS);
    };
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
  db.onversionchange = () => db.close();
  try {
    await moveOldChat(db);
  } catch (e) {
    // It's still where it was, for next time.
    console.error("couldn't move the old chat", e);
  }
  return {
    async list() {
      const all = await result(db.transaction(LISTINGS).objectStore(LISTINGS).getAll() as IDBRequest<Listing[]>);
      return all.sort((a, b) => b.updated - a.updated);
    },
    read: (id) => result(db.transaction(CHATS).objectStore(CHATS).get(id) as IDBRequest<Saved | undefined>),
    async write(listing, chat) {
      const tx = db.transaction([LISTINGS, CHATS], "readwrite");
      tx.objectStore(LISTINGS).put(listing);
      tx.objectStore(CHATS).put(chat, listing.id);
      // Without this, a page on its way out might not get as far as committing.
      tx.commit();
      return finished(tx);
    },
    async retitle(id, title) {
      const tx = db.transaction(LISTINGS, "readwrite");
      const listings = tx.objectStore(LISTINGS);
      const there = listings.get(id) as IDBRequest<Listing | undefined>;
      there.onsuccess = () => {
        if (there.result) listings.put({ ...there.result, title });
      };
      return finished(tx);
    },
    async remove(id) {
      const tx = db.transaction([LISTINGS, CHATS], "readwrite");
      tx.objectStore(LISTINGS).delete(id);
      tx.objectStore(CHATS).delete(id);
      return finished(tx);
    },
  };
}

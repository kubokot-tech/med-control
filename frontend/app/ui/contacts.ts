/** A doctor or other contact (GET /contacts, gateway/src/lib/contacts.js). */
export type Contact = {
  id: string; name: string; role: string | null; clinic: string | null; phones: string[]; email: string | null;
  address: string | null; url: string | null; notes: string | null; pinned: boolean;
};

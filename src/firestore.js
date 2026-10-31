import { getApps, initializeApp } from "firebase-admin/app";
import { FieldValue, Timestamp, getFirestore } from "firebase-admin/firestore";

const app = getApps()[0] ?? initializeApp();

// Read only. The ai-gen service account has roles/datastore.viewer on (default), so a write here fails.
export const defaultDb = getFirestore(app);

// Every write goes here. The ai-gen service account has roles/datastore.user on this database only.
export const aiDb = getFirestore(app, "ai");

export { FieldValue, Timestamp };

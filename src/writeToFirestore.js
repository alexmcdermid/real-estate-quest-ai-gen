import { initializeApp, cert } from "firebase-admin/app";
import { getFirestore, FieldValue } from "firebase-admin/firestore";

let db;

function getDb() {
  if (!db) {
    const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON);
    initializeApp({ credential: cert(serviceAccount) });
    db = getFirestore();
  }
  return db;
}

/**
 * Queries both pending and approved collections to find the highest
 * questionNumber for this chapter, so new questions increment correctly.
 */
export async function getLastAiQuestionNumber(chapter) {
  const db = getDb();
  const [pendingSnap, approvedSnap] = await Promise.all([
    db.collection("questionsAiPending").where("chapter", "==", chapter).orderBy("questionNumber", "desc").limit(1).get(),
    db.collection("questionsAiApproved").where("chapter", "==", chapter).orderBy("questionNumber", "desc").limit(1).get(),
  ]);

  const numbers = [];
  if (!pendingSnap.empty) numbers.push(pendingSnap.docs[0].data().questionNumber);
  if (!approvedSnap.empty) numbers.push(approvedSnap.docs[0].data().questionNumber);
  return numbers.length > 0 ? Math.max(...numbers) : 0;
}

/**
 * Writes the generated question to the questionsAiPending collection.
 * The real-estate-quest admin console reads this collection for review.
 */
export async function writePendingQuestion(question) {
  const db = getDb();
  await db.collection("questionsAiPending").add({
    ...question,
    status: "pending",
    generatedAt: FieldValue.serverTimestamp(),
  });
  console.log(`Written to questionsAiPending: chapter ${question.chapter}, Q${question.questionNumber}`);
}

#!/usr/bin/env bash
# One-time access setup for the ai-gen functions codebase. Safe to re-run: it skips what already exists, and
# re-applying a grant that's already there changes nothing.
#
# Creates the ai Firestore database and the ai-gen service account, and grants that account:
#   - roles/datastore.user on the ai database only (read and write)
#   - roles/datastore.viewer on the (default) database only (read only)
#   - roles/secretmanager.secretAccessor on the ANTHROPIC_API_KEY secret only
#
# Usage (as a project owner, after `gcloud auth login`):
#   scripts/setup-ai-gen-access.sh
#   DEPLOYER_MEMBER="user:you@example.com" scripts/setup-ai-gen-access.sh   # also lets that member deploy as ai-gen
set -euo pipefail

PROJECT_ID="${PROJECT_ID:-real-estate-quest}"
DEPLOYER_MEMBER="${DEPLOYER_MEMBER:-}"
AI_DATABASE_ID="ai"
SERVICE_ACCOUNT_NAME="ai-gen"
SERVICE_ACCOUNT_EMAIL="${SERVICE_ACCOUNT_NAME}@${PROJECT_ID}.iam.gserviceaccount.com"
SERVICE_ACCOUNT_MEMBER="serviceAccount:${SERVICE_ACCOUNT_EMAIL}"
ANTHROPIC_SECRET_NAME="ANTHROPIC_API_KEY"
AI_DATABASE_RESOURCE_NAME="projects/${PROJECT_ID}/databases/${AI_DATABASE_ID}"
DEFAULT_DATABASE_RESOURCE_NAME="projects/${PROJECT_ID}/databases/(default)"
# Fixed titles keep re-runs idempotent: a binding is only a duplicate when its whole condition matches.
AI_DATABASE_CONDITION_TITLE="ai-gen read and write on the ai database"
DEFAULT_DATABASE_CONDITION_TITLE="ai-gen read only on the default database"

if ! command -v gcloud >/dev/null 2>&1; then
  echo "gcloud isn't installed: https://cloud.google.com/sdk/docs/install" >&2
  exit 1
fi

echo "Project: ${PROJECT_ID}"

echo "Checking that the ${ANTHROPIC_SECRET_NAME} secret exists..."
if ! gcloud secrets describe "${ANTHROPIC_SECRET_NAME}" --project="${PROJECT_ID}" >/dev/null; then
  echo "Couldn't read the ${ANTHROPIC_SECRET_NAME} secret (see the error above). If it doesn't exist yet, set it first," >&2
  echo "then re-run this script: firebase functions:secrets:set ${ANTHROPIC_SECRET_NAME} --project ${PROJECT_ID}" >&2
  exit 1
fi

echo "Step 1: reading the location of the (default) database..."
DEFAULT_DATABASE_LOCATION="$(gcloud firestore databases describe --database="(default)" --project="${PROJECT_ID}" \
  --format="value(locationId)")"
if [[ -z "${DEFAULT_DATABASE_LOCATION}" ]]; then
  echo "Couldn't read the location of the (default) database." >&2
  exit 1
fi
if gcloud firestore databases describe --database="${AI_DATABASE_ID}" --project="${PROJECT_ID}" >/dev/null 2>&1; then
  echo "The ${AI_DATABASE_ID} database already exists."
else
  echo "Creating the ${AI_DATABASE_ID} database in ${DEFAULT_DATABASE_LOCATION}..."
  gcloud firestore databases create --database="${AI_DATABASE_ID}" --location="${DEFAULT_DATABASE_LOCATION}" \
    --type=firestore-native --project="${PROJECT_ID}"
fi

echo "Step 2: service account ${SERVICE_ACCOUNT_EMAIL}..."
if gcloud iam service-accounts describe "${SERVICE_ACCOUNT_EMAIL}" --project="${PROJECT_ID}" >/dev/null 2>&1; then
  echo "The service account already exists."
else
  echo "Creating the service account..."
  gcloud iam service-accounts create "${SERVICE_ACCOUNT_NAME}" --project="${PROJECT_ID}" \
    --display-name="AI question and flashcard generator (ai-gen functions)"
  echo "Waiting 15 seconds for the new service account to propagate (if a grant below says it doesn't exist, re-run)..."
  sleep 15
fi

# Each grant has a condition naming its database. Without one, a grant covers every database in the project.
echo "Step 3: granting roles/datastore.user on the ${AI_DATABASE_ID} database only..."
gcloud projects add-iam-policy-binding "${PROJECT_ID}" \
  --member="${SERVICE_ACCOUNT_MEMBER}" \
  --role="roles/datastore.user" \
  --condition="expression=resource.name == \"${AI_DATABASE_RESOURCE_NAME}\",title=${AI_DATABASE_CONDITION_TITLE}" \
  --format=none

echo "Step 3: granting roles/datastore.viewer on the (default) database only..."
gcloud projects add-iam-policy-binding "${PROJECT_ID}" \
  --member="${SERVICE_ACCOUNT_MEMBER}" \
  --role="roles/datastore.viewer" \
  --condition="expression=resource.name == \"${DEFAULT_DATABASE_RESOURCE_NAME}\",title=${DEFAULT_DATABASE_CONDITION_TITLE}" \
  --format=none

echo "Step 4: granting roles/secretmanager.secretAccessor on the ${ANTHROPIC_SECRET_NAME} secret only..."
gcloud secrets add-iam-policy-binding "${ANTHROPIC_SECRET_NAME}" --project="${PROJECT_ID}" \
  --member="${SERVICE_ACCOUNT_MEMBER}" \
  --role="roles/secretmanager.secretAccessor" \
  --format=none

echo "Step 5: letting the deployer act as the service account..."
if [[ -n "${DEPLOYER_MEMBER}" ]]; then
  gcloud iam service-accounts add-iam-policy-binding "${SERVICE_ACCOUNT_EMAIL}" --project="${PROJECT_ID}" \
    --member="${DEPLOYER_MEMBER}" \
    --role="roles/iam.serviceAccountUser" \
    --format=none
  echo "Granted roles/iam.serviceAccountUser to ${DEPLOYER_MEMBER}."
else
  echo "DEPLOYER_MEMBER isn't set; skipped. Project owners can already deploy functions that run as ${SERVICE_ACCOUNT_EMAIL}."
fi

echo "Done. Next: firebase deploy --only firestore, firebase deploy --only functions:ai-gen, and scripts/check-ai-gen-access.sh."

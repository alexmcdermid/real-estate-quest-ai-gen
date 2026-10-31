#!/usr/bin/env bash
# Checks the ai-gen access boundary after scripts/setup-ai-gen-access.sh, by calling the Firestore REST API as the
# ai-gen service account:
#   1. a write to the (default) database is refused (HTTP 403)
#   2. a write to the ai database works (HTTP 200), and the test document is deleted again
#   3. a read from the (default) database works (HTTP 200, or 404 while metadata/aiQuestions doesn't exist)
#
# Impersonating ai-gen needs roles/iam.serviceAccountTokenCreator on the service account for whoever runs this:
#   gcloud iam service-accounts add-iam-policy-binding ai-gen@real-estate-quest.iam.gserviceaccount.com \
#     --member="user:you@example.com" --role="roles/iam.serviceAccountTokenCreator"
# IAM changes can take a few minutes to apply, so re-run if a check fails right after the setup.
set -euo pipefail

PROJECT_ID="${PROJECT_ID:-real-estate-quest}"
SERVICE_ACCOUNT_EMAIL="ai-gen@${PROJECT_ID}.iam.gserviceaccount.com"
FIRESTORE_DATABASES_URL="https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases"
CHECK_COLLECTION="aiGenAccessCheck"
CHECK_DOCUMENT_ID="check-$(date +%s)"
CHECK_DOCUMENT_BODY='{"fields": {"note": {"stringValue": "ai-gen access check, safe to delete"}}}'

echo "Getting an access token as ${SERVICE_ACCOUNT_EMAIL}..."
ACCESS_TOKEN="$(gcloud auth print-access-token --impersonate-service-account="${SERVICE_ACCOUNT_EMAIL}")"

failed_check_count=0

# Prints the HTTP status of one Firestore REST request ("000" when it couldn't be sent).
firestore_request() {
  local method="$1" url="$2" body="${3:-}"
  local curl_arguments=(--silent --output /dev/null --write-out "%{http_code}" --request "${method}"
    --header "Authorization: Bearer ${ACCESS_TOKEN}")
  if [[ -n "${body}" ]]; then
    curl_arguments+=(--header "Content-Type: application/json" --data "${body}")
  fi
  curl "${curl_arguments[@]}" "${url}" || true
}

# Prints PASS or FAIL with a description and counts failures.
report() {
  local result="$1" description="$2"
  echo "${result}: ${description}"
  if [[ "${result}" == "FAIL" ]]; then
    failed_check_count=$((failed_check_count + 1))
  fi
}

echo "Check 1: writing a test document to (default)..."
default_write_status="$(firestore_request POST \
  "${FIRESTORE_DATABASES_URL}/(default)/documents/${CHECK_COLLECTION}?documentId=${CHECK_DOCUMENT_ID}" "${CHECK_DOCUMENT_BODY}")"
if [[ "${default_write_status}" == "403" ]]; then
  report PASS "the write to (default) was refused (HTTP 403)"
else
  report FAIL "the write to (default) returned HTTP ${default_write_status}, expected 403"
  if [[ "${default_write_status}" == "200" ]]; then
    echo "Deleting the test document the write created in (default)..."
    firestore_request DELETE "${FIRESTORE_DATABASES_URL}/(default)/documents/${CHECK_COLLECTION}/${CHECK_DOCUMENT_ID}" >/dev/null
  fi
fi

echo "Check 2: writing and deleting a test document in ai..."
ai_write_status="$(firestore_request POST \
  "${FIRESTORE_DATABASES_URL}/ai/documents/${CHECK_COLLECTION}?documentId=${CHECK_DOCUMENT_ID}" "${CHECK_DOCUMENT_BODY}")"
if [[ "${ai_write_status}" == "200" ]]; then
  ai_delete_status="$(firestore_request DELETE \
    "${FIRESTORE_DATABASES_URL}/ai/documents/${CHECK_COLLECTION}/${CHECK_DOCUMENT_ID}")"
  if [[ "${ai_delete_status}" == "200" ]]; then
    report PASS "the write to ai and the delete worked (HTTP 200)"
  else
    report FAIL "the delete in ai returned HTTP ${ai_delete_status}, expected 200"
  fi
else
  report FAIL "the write to ai returned HTTP ${ai_write_status}, expected 200"
fi

echo "Check 3: reading metadata/aiQuestions from (default)..."
default_read_status="$(firestore_request GET "${FIRESTORE_DATABASES_URL}/(default)/documents/metadata/aiQuestions")"
if [[ "${default_read_status}" == "200" || "${default_read_status}" == "404" ]]; then
  report PASS "the read from (default) worked (HTTP ${default_read_status})"
else
  report FAIL "the read from (default) returned HTTP ${default_read_status}, expected 200 or 404"
fi

if ((failed_check_count > 0)); then
  echo "${failed_check_count} check(s) failed." >&2
  exit 1
fi
echo "All checks passed."

# Installed immediately after deploy-runtime.sh's shebang, before reading .env.
# Explicit primary rollback restores the original script from its own snapshot.
if systemctl --user is-enabled --quiet local-ai-primary.service 2>/dev/null; then
  echo 'The resident primary runtime owns both backends. Use ~/primary; deploy the router service independently. Legacy all-GPU deployment is disabled until explicit primary rollback.' >&2
  exit 2
fi

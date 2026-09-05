#!/usr/bin/env node

const routerUrl = String(process.env.ROUTER_URL || 'http://127.0.0.1:11434').replace(/\/+$/, '');
const requestedModel = process.env.REQUESTED_MODEL || 'local-active';
const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl+X1cAAAAASUVORK5CYII=';
const dataUrl = `data:image/png;base64,${png}`;

function fail(message, details = null) {
  console.error(message);
  if (details !== null) console.error(typeof details === 'string' ? details : JSON.stringify(details, null, 2));
  process.exit(1);
}

async function jsonResponse(response) {
  const text = await response.text();
  try {
    return { text, body: text ? JSON.parse(text) : null };
  } catch {
    return { text, body: null };
  }
}

const listingResponse = await fetch(`${routerUrl}/v1/models`, {
  headers: { accept: 'application/json' }
});
const listing = await jsonResponse(listingResponse);
if (!listingResponse.ok) fail(`Model discovery returned HTTP ${listingResponse.status}.`, listing.body ?? listing.text);
const model = listing.body?.data?.find((entry) => entry?.id === requestedModel);
if (!model) fail(`Model discovery did not expose ${requestedModel}.`, listing.body);
const metadata = model.x_ollama_router;
if (metadata?.schema_version !== 2 || metadata.complete !== true) {
  fail('Router discovery is not a complete schema-v2 document.', metadata);
}
if (!metadata.input_modalities?.includes('image') || !metadata.capabilities?.includes('vision')) {
  fail('The active marker/backend does not advertise verified vision support.', metadata);
}
if (!metadata.capabilities?.includes('tools')) {
  fail('The active marker/backend does not advertise tool support.', metadata);
}

const response = await fetch(`${routerUrl}/v1/responses`, {
  method: 'POST',
  headers: {
    accept: 'application/json',
    'content-type': 'application/json',
    'x-client-name': 'router-vision-smoke'
  },
  body: JSON.stringify({
    model: requestedModel,
    input: [
      { role: 'user', content: 'A browser screenshot tool was used. Briefly confirm that you can inspect its image output.' },
      {
        type: 'function_call',
        call_id: 'call_vision_smoke',
        name: 'browser_screenshot',
        arguments: '{}'
      },
      {
        type: 'function_call_output',
        call_id: 'call_vision_smoke',
        output: [
          { type: 'input_text', text: 'Synthetic one-pixel PNG from the router vision smoke test.' },
          { type: 'input_image', image_url: dataUrl, detail: 'auto' }
        ]
      }
    ],
    tools: [{
      type: 'function',
      name: 'browser_screenshot',
      description: 'Capture a browser screenshot.',
      parameters: { type: 'object', properties: {} }
    }],
    tool_choice: 'auto',
    reasoning: { effort: 'none' },
    max_output_tokens: 128,
    stream: false,
    store: false
  })
});
const result = await jsonResponse(response);
if (!response.ok) fail(`Vision Responses smoke test returned HTTP ${response.status}.`, result.body ?? result.text);
if (result.body?.status !== 'completed') fail('Vision Responses smoke test did not complete.', result.body);

console.log(`VISION_SMOKE_VERIFIED router=${routerUrl} model=${requestedModel} profile=${metadata.profile ?? 'unknown'}`);

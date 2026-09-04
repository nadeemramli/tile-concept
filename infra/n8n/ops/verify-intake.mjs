const relayUrl = process.env.RELAY_URL ?? "http://intake-relay:3000/intake";
const response = await fetch(relayUrl, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: "{}",
});

const result = await response.json();
if (response.status !== 400 || result.error !== "invalid_body") {
  throw new Error(`Unexpected relay result: ${response.status} ${JSON.stringify(result)}`);
}

process.stdout.write("Signed relay reached the app and was rejected only by schema validation.\n");

// Regression invariants: security core must not depend on DOM selectors.
// This file is intentionally destination/framework agnostic.
const source = typeof AKILA_TRANSPORT_GUARD_SOURCE === "string" ? AKILA_TRANSPORT_GUARD_SOURCE : "";
if (source && /querySelector|querySelectorAll|getElementById/.test(source)) {
  throw new Error("Transport guard must not depend on DOM selectors");
}
console.log("AKILA transport regression invariants OK");

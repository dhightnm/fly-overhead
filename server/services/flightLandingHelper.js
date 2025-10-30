// flightLandingHelper.js
function shouldFilterAsLanded(lastContact, lastArrival, bufferMs = 10 * 60 * 1000) {
  if (!lastArrival) return false;
  return lastContact <= lastArrival + bufferMs;
}
module.exports = { shouldFilterAsLanded };

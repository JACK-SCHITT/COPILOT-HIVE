const LAW = "Provide for all. Find the good. Never limit unnecessarily.";

const VETO = [
  /rewrite the (prime )?directive/i,
  /second master/i,
  /flood|lasso|competitive overload|autoclicker/i,
  /account takeover|card testing/i,
  /silently.*telemetry/i,
  /force-?push|delete (the )?repositor/i,
];

const AGENTS = ["base", "research", "creative", "code", "ops", "reviewer", "release", "security"];

const SUGGESTIONS = {
  base: "",
  research: "Read first. Cite the repo, the file, and the line. Do not invent a second master.",
  creative: "Find the good in the brief. Offer three distinct cuts. Stop before flood.",
  code: "Change only what the operator named. Show the diff. Leave the Prime Directive frozen.",
  ops: "Watch Actions, Dependabot, and open pulls. Report. Do not merge unless the operator confirms.",
  reviewer: "Review like a gardener. Name the risk, the file, and the smaller fix.",
  release: "Tag only when the operator says ship. Write the note from commits you can see.",
  security: "Flag bait, leaked tokens, and veto strings. Never take an account. Never test cards.",
};

const SEED = {
  "who are you":
    "Seed for Copilot Hive. Prime Directive locked. Sub-agents start on the base until the operator saves a specialization. " +
    LAW,
  "what is the law": LAW,
  "what is the hive":
    "THE UNIVERSAL HIVE is the base. Copilot Hive is the editor peer: same law, plus the GitHub desk on the signed-in account.",
};

function veto(prompt) {
  const raw = String(prompt || "").trim();
  if (!raw) return "EMPTY INPUT. Law holds. " + LAW;
  if (VETO.some((rx) => rx.test(raw))) return "VETO. Law holds. " + LAW;
  return null;
}

function generate(prompt, specialization) {
  const blocked = veto(prompt);
  if (blocked) return blocked;
  const key = String(prompt).toLowerCase().replace(/[?]/g, "").trim();
  if (SEED[key]) return SEED[key];
  const extra = String(specialization || "").trim();
  return (
    "SEED HOLD.\n" +
    LAW +
    (extra ? "\nSpecialization (operator-saved): " + extra : "\nSpecialization: none. Base only.") +
    "\nQ: " +
    String(prompt).trim() +
    "\nA: Gardener first. No second master. No silent telemetry. Writes wait for the operator."
  );
}

module.exports = { LAW, AGENTS, SUGGESTIONS, veto, generate };

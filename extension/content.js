// Wait for page to load

function parseReplay(jsonData) {
  // Parse the log
  const result = {
    players: {},
    format: jsonData.format || "",
    winner: "",
    killLog: [],
  };

  const log = jsonData.log;
  const lines = log.split("\n");
  const activeMons = { p1: null, p2: null };
  const nicknameToSpecies = {}; // Need to map nicknames to actual species
  const hazardSetters = { p1: {}, p2: {} }; // Trying to track who set each hazard type. Doesn't really work :(
  let currentTurn = 0;

  for (const line of lines) {
    const parts = line.split("|");

    if (parts[1] === "turn") {
      currentTurn = parseInt(parts[2]);
    }

    if (parts[1] === "tier") {
      result.format = parts[2];
    }

    if (parts[1] === "player") {
      const player = parts[2];
      const name = parts[3];
      if (!result.players[player]) {
        result.players[player] = {
          name: name,
          team: [],
          mons: {},
        };
      }
    }

    // Team preview
    if (parts[1] === "poke") {
      const player = parts[2];
      const fullInfo = parts[3];
      let speciesName = fullInfo.split(",")[0]; // Get just the species

      // I had an issue with Greninja-* / Greninja-Bond. So just remove it
      speciesName = speciesName.replace("-*", "");

      // This initialize the team member in preview order
      if (!result.players[player].mons[speciesName]) {
        result.players[player].team.push(speciesName);
        result.players[player].mons[speciesName] = {
          kills: 0,
          died: false,
          hazardKill: false,
        };
      }
    }

    // Track hazard setters
    if (parts[1] === "-sidestart") {
      const side = parts[2].split(":")[0]; // "p1" or "p2"
      const opponent = side === "p1" ? "p2" : "p1";
      const hazardType = parts[3]; // "move: Stealth Rock"

      // Credit the opponent's active mon with setting this hazard
      if (activeMons[opponent]) {
        hazardSetters[side][hazardType] = activeMons[opponent];
      }
    }

    // Track damage to detect indirect kills (hazards, weather, status)
    if (parts[1] === "-damage") {
      const playerMon = parts[2].split(":")[0];
      const player = playerMon.substring(0, 2);
      const hpInfo = parts[3]; // e.g., "0 fnt" or "50/100"

      // Check if this is indirect damage (has [from] tag)
      if (parts.length > 4 && parts[4] && parts[4].startsWith("[from]")) {
        const source = parts[4]; // e.g., "[from] Stealth Rock" or "[from] psn"

        // If HP went to 0, handle the indirect kill
        if (hpInfo.includes("0 fnt")) {
          const opponent = player === "p1" ? "p2" : "p1";

          // Determine the kill source type
          let killSource = "";
          if (source.includes("Stealth Rock")) {
            killSource = "rocks";
          } else if (source.includes("Spikes")) {
            killSource = "spikes";
          } else if (source.includes("Toxic Spikes")) {
            killSource = "toxic spikes";
          } else if (source.includes("Sticky Web")) {
            killSource = "sticky web";
          } else if (source.includes("psn") || source.includes("tox")) {
            killSource = "poison";
          } else if (source.includes("brn")) {
            killSource = "burn";
          } else if (source.includes("Sandstorm")) {
            killSource = "sandstorm";
          } else if (source.includes("Hail")) {
            killSource = "hail";
          } else {
            killSource = source.replace("[from] ", "").toLowerCase();
          }

          // Store the kill source for the next faint line
          activeMons._lastKillSource = killSource;

          // Check if this was a hazard kill
          if (
            killSource === "rocks" ||
            killSource === "spikes" ||
            killSource === "toxic spikes" ||
            killSource === "sticky web"
          ) {
            const hazardKey = source.replace("[from] ", "move: ");
            const hazardSetter = hazardSetters[player][hazardKey];

            if (hazardSetter) {
              // Credit the hazard setter
              activeMons[opponent] = hazardSetter;
            } else {
              // Unknown hazard setter
              activeMons[opponent] = null;
            }
          } else {
            // Status/weather kill - no killer
            activeMons[opponent] = null;
          }
        }
      }
    }

    // Track switches and build nickname map
    if (parts[1] === "switch" || parts[1] === "drag") {
      const playerMon = parts[2]; // e.g., "p1a: GODZAMN"
      const player = playerMon.split(":")[0].substring(0, 2);
      const nickname = playerMon.split(":")[1].trim(); // "GODZAMN"

      const fullInfo = parts[3]; // e.g., "Alakazam-Mega, M" or "Indeedee-F, F"
      let speciesName = fullInfo.split(",")[0]; // "Alakazam-Mega"

      // Remove temporary forme suffixes (Mega, Primal) but keep permanent forms
      let baseName = speciesName;
      if (speciesName.includes("-Mega") || speciesName.includes("-Primal")) {
        baseName = speciesName.split("-Mega")[0].split("-Primal")[0];
      }

      // Always map to base name
      nicknameToSpecies[nickname] = baseName;
      activeMons[player] = baseName;
    }

    // Track faints - nickname maps to get actual species
    if (parts[1] === "faint") {
      const playerMon = parts[2].split(":")[0];
      const player = playerMon.substring(0, 2);
      const nickname = parts[2].split(":")[1].trim();

      const speciesName = nicknameToSpecies[nickname] || nickname;

      const killSource = activeMons._lastKillSource || "";

      // Check if this was a hazard kill
      const isHazardKill = [
        "rocks",
        "spikes",
        "toxic spikes",
        "sticky web",
      ].includes(killSource);

      // Mark dead
      if (result.players[player].mons[speciesName]) {
        result.players[player].mons[speciesName].died = true;
        result.players[player].mons[speciesName].hazardKill = isHazardKill;
      }

      // Credit kill to opponent's active mon?
      const opponent = player === "p1" ? "p2" : "p1";
      const killerMon = activeMons[opponent];
      if (killerMon && result.players[opponent].mons[killerMon]) {
        result.players[opponent].mons[killerMon].kills++;
      }

      // And then add to kill log
      result.killLog.push({
        turn: currentTurn,
        killerMon: killerMon || "",
        killerTeam: killerMon ? opponent : "",
        victimMon: speciesName,
        victimTeam: player,
        killSource: killSource,
      });

      // Done, so clear the kill source
      activeMons._lastKillSource = "";
    }

    // Get winner!!
    if (parts[1] === "win") {
      result.winner = parts[2];
    }
  }

  return result;
}

function displayResults(data) {
  // Remove existing results
  const existing = document.getElementById("ps-parser-results");
  if (existing) {
    existing.remove();
  }

  // Results container
  const container = document.createElement("div");
  container.id = "ps-parser-results";
  container.className = "ps-parser-results";

  let html = '<div class="ps-parser-header">';
  html += "<h2>Match Stats</h2>";
  html += '<div style="display: flex; gap: 10px;">';

  const playerNames = Object.entries(data.players).map(([key, player]) => ({
    key: key,
    name: player.name,
  }));

  playerNames.forEach((p) => {
    html += `<button id="ps-parser-copy-${p.key}" class="ps-parser-copy-btn">Copy ${p.name}</button>`;
  });

  html += '<button id="ps-parser-close">Close</button>';
  html += "</div>";
  html += "</div>";

  if (data.format) {
    html += `<p><strong>Format:</strong> ${data.format}</p>`;
  }
  if (data.winner) {
    html += `<p><strong>Winner:</strong> ${data.winner}</p>`;
  }

  html += '<div class="ps-parser-teams">';

  for (const [playerKey, player] of Object.entries(data.players)) {
    html += `<div class="ps-parser-team">`;
    html += `<h3>${player.name}</h3>`;
    html += "<table>";
    html +=
      "<thead><tr><th>Pokemon</th><th>Kills</th><th>Status</th></tr></thead>";
    html += "<tbody>";

    for (const mon of player.team) {
      const monData = player.mons[mon];
      const status = monData.died ? "Fainted" : "Alive";
      const statusClass = monData.died ? "died" : "alive";
      html += `<tr>`;
      html += `<td>${mon}</td>`;
      html += `<td>${monData.kills}</td>`;
      html += `<td class="${statusClass}">${status}</td>`;
      html += `</tr>`;
    }

    html += "</tbody></table>";
    html += "</div>";
  }

  html += "</div>";

  // Kill Timeline
  if (data.killLog && data.killLog.length > 0) {
    html += '<div class="ps-parser-team" style="margin-top: 20px;">';
    html += "<h3>Kill Timeline</h3>";
    html += "<table>";
    html +=
      "<thead><tr><th>Turn</th><th>Killer</th><th>Killer Team</th><th>Victim</th><th>Victim Team</th><th>Source</th></tr></thead>";
    html += "<tbody>";

    for (const entry of data.killLog) {
      const killerTeamName = entry.killerTeam
        ? data.players[entry.killerTeam].name
        : "";
      const victimTeamName = data.players[entry.victimTeam].name;
      const killSourceDisplay = entry.killSource || "";

      html += `<tr>`;
      html += `<td>${entry.turn}</td>`;
      html += `<td>${entry.killerMon || "<em>Unknown</em>"}</td>`;
      html += `<td>${killerTeamName}</td>`;
      html += `<td>${entry.victimMon}</td>`;
      html += `<td>${victimTeamName}</td>`;
      html += `<td>${killSourceDisplay}</td>`;
      html += `</tr>`;
    }

    html += "</tbody></table>";
    html += "</div>";
  }

  container.innerHTML = html;
  document.body.appendChild(container);

  document.getElementById("ps-parser-close").addEventListener("click", () => {
    container.remove();
  });

  const playerEntries = Object.entries(data.players);
  playerEntries.forEach(([playerKey, player]) => {
    document
      .getElementById(`ps-parser-copy-${playerKey}`)
      .addEventListener("click", () => {
        copyPlayerToClipboard(playerKey, player);
      });
  });
}

function copyPlayerToClipboard(playerKey, player) {
  let text = "";

  for (const mon of player.team) {
    const monData = player.mons[mon];
    text += `${mon}\t${monData.kills}\t${monData.died ? "1" : "0"}\n`;
  }

  navigator.clipboard.writeText(text).then(() => {
    const btn = document.getElementById(`ps-parser-copy-${playerKey}`);
    const orig = btn.textContent;
    btn.textContent = "Copied!";
    setTimeout(() => {
      btn.textContent = orig;
    }, 2000);
  });
}

window.addEventListener("load", () => {
  // Create button
  const btn = document.createElement("button");
  btn.id = "ps-parser-btn";
  btn.textContent = "Extract Stats";
  btn.className = "ps-parser-button";

  document.body.appendChild(btn);

  const aboutBtn = document.createElement("button");
  aboutBtn.id = "ps-parser-about-btn";
  aboutBtn.textContent = "About";
  aboutBtn.className = "ps-parser-about-button";
  document.body.appendChild(aboutBtn);

  btn.addEventListener("click", async () => {
    btn.textContent = "Parsing...";
    btn.disabled = true;

    try {
      let url = window.location.href.split("?")[0].replace(/\/$/, "");
      url += ".json";

      const response = await fetch(url);
      if (!response.ok) {
        throw new Error("Failed to fetch replay data");
      }

      const json = await response.json();
      const result = parseReplay(json);

      displayResults(result);
    } catch (err) {
      alert("Error parsing replay: " + err.message);
    } finally {
      btn.textContent = "Extract Stats";
      btn.disabled = false;
    }
  });

  aboutBtn.addEventListener("click", () => {
    showAbout();
  });
});

function showAbout() {
  const existing = document.getElementById("ps-parser-about");
  if (existing) {
    existing.remove();
    return;
  }

  const aboutPanel = document.createElement("div");
  aboutPanel.id = "ps-parser-about";
  aboutPanel.className = "ps-parser-results";

  let html = '<div class="ps-parser-header">';
  html += "<h2>Polypaster</h2>";
  html += '<button id="ps-parser-about-close">Close</button>';
  html += "</div>";

  html += '<div style="padding: 10px 0;">';
  html += "<p><strong>By:</strong> Christian / Blister</p>";
  html +=
    "<p><strong><a href='https://www.loom.com/share/71aeeaafbd4a43b680006562854ad032' target='_blank'>How it works</a></strong></p>";
  html +=
    '<p><strong>Showdown:</strong> <a href="https://pokemonshowdown.com/users/blisterinsun" target="_blank" style="color: #2563eb;">blisterinsun</a></p>';
  html +=
    '<p><strong>GitHub:</strong> <a href="https://github.com/cpayne22/polypaster" target="_blank" style="color: #2563eb;">cpayne22/polypaster</a></p>';
  html += "<p><strong>Version:</strong> 1.0.1</p>";
  html += "</div>";

  aboutPanel.innerHTML = html;
  document.body.appendChild(aboutPanel);

  document
    .getElementById("ps-parser-about-close")
    .addEventListener("click", () => {
      aboutPanel.remove();
    });
}

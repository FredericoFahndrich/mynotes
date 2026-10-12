const themeToggle = document.getElementById("themeToggle");

let lightMode = true;

themeToggle.addEventListener("click", () => {
  if (lightMode) {
    document.body.style.background =
      "linear-gradient(135deg, #1a2940, #233c61, #31598a)";
    document.body.style.color = "#eaf2ff";
    themeToggle.textContent = "☾";
  } else {
    document.body.style.background =
      "radial-gradient(circle at top left, #edf6ff 0%, transparent 35%), radial-gradient(circle at bottom right, #7bb6ff 0%, transparent 30%), linear-gradient(135deg, #d9e8f7, #bcd4f3, #8bb9f2)";
    document.body.style.color = "";
    themeToggle.textContent = "☀";
  }

  lightMode = !lightMode;
});

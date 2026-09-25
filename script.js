const header = document.querySelector("[data-header]");
const menuToggle = document.querySelector(".menu-toggle");
const nav = document.querySelector(".site-nav");
const navLinks = document.querySelectorAll(".site-nav a");
const revealItems = document.querySelectorAll(".reveal");

const setHeaderState = () => header?.classList.toggle("scrolled", window.scrollY > 24);
setHeaderState();
window.addEventListener("scroll", setHeaderState, { passive: true });

const closeMenu = () => {
  menuToggle?.setAttribute("aria-expanded", "false");
  nav?.classList.remove("open");
  document.body.style.overflow = "";
};

menuToggle?.addEventListener("click", () => {
  const shouldOpen = menuToggle.getAttribute("aria-expanded") !== "true";
  menuToggle.setAttribute("aria-expanded", String(shouldOpen));
  nav?.classList.toggle("open", shouldOpen);
  document.body.style.overflow = shouldOpen ? "hidden" : "";
});

navLinks.forEach((link) => link.addEventListener("click", closeMenu));
document.addEventListener("keydown", (event) => event.key === "Escape" && closeMenu());

const observer = new IntersectionObserver(
  (entries) => {
    entries.forEach((entry) => {
      if (entry.isIntersecting) {
        entry.target.classList.add("visible");
        observer.unobserve(entry.target);
      }
    });
  },
  { threshold: 0.1, rootMargin: "0px 0px -7%" },
);

revealItems.forEach((item, index) => {
  item.style.transitionDelay = `${Math.min(index % 3, 2) * 70}ms`;
  observer.observe(item);
});

const updateTime = () => {
  const formatted = new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit" }).format(new Date());
  document.querySelectorAll("[data-time]").forEach((item) => { item.textContent = formatted; });
};

updateTime();
setInterval(updateTime, 30_000);
document.querySelector("[data-year]").textContent = new Date().getFullYear();

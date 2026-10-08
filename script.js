const burger = document.getElementById("burger");
const mobileMenu = document.getElementById("mobileMenu");
const header = document.getElementById("header");

function closeMenu() {
  burger.classList.remove("is-open");
  mobileMenu.classList.remove("is-open");
  document.body.style.overflow = "";
}

burger.addEventListener("click", () => {
  const open = burger.classList.toggle("is-open");
  mobileMenu.classList.toggle("is-open", open);
  document.body.style.overflow = open ? "hidden" : "";
});

mobileMenu.querySelectorAll("a").forEach((link) => {
  link.addEventListener("click", closeMenu);
});

window.addEventListener("scroll", () => {
  header.classList.toggle("is-scrolled", window.scrollY > 10);
}, { passive: true });

const revealItems = document.querySelectorAll(".reveal");

if ("IntersectionObserver" in window) {
  const observer = new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
      if (entry.isIntersecting) {
        entry.target.classList.add("is-visible");
        observer.unobserve(entry.target);
      }
    });
  }, { threshold: 0.15, rootMargin: "0px 0px -40px 0px" });

  revealItems.forEach((item) => observer.observe(item));
} else {
  revealItems.forEach((item) => item.classList.add("is-visible"));
}

const sectionIds = ["top", "advantages", "pricing", "support"];

const navLinks = document.querySelectorAll(".nav__link");
const bottomItems = document.querySelectorAll(".bottom-nav__item");

function updateActiveNav() {
  const pos = window.scrollY + 140;
  let current = "top";

  sectionIds.forEach((id) => {
    const el = document.getElementById(id);
    if (el && el.offsetTop <= pos) current = id;
  });

  navLinks.forEach((link) => {
    link.classList.toggle("is-active", link.getAttribute("href") === "#" + current);
  });

  const bottomMap = { top: "#top", advantages: "#cabinet", pricing: "#pricing", support: "#pricing" };
  bottomItems.forEach((item) => {
    item.classList.toggle("is-active", item.getAttribute("href") === bottomMap[current]);
  });
}

window.addEventListener("scroll", updateActiveNav, { passive: true });
updateActiveNav();

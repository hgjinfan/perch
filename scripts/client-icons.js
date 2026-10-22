import createElement from 'lucide/dist/esm/createElement.js';
import Activity from 'lucide/dist/esm/icons/activity.js';
import ArrowUpRight from 'lucide/dist/esm/icons/arrow-up-right.js';
import Bell from 'lucide/dist/esm/icons/bell.js';
import Bookmark from 'lucide/dist/esm/icons/bookmark.js';
import Box from 'lucide/dist/esm/icons/box.js';
import Cloud from 'lucide/dist/esm/icons/cloud.js';
import CloudFog from 'lucide/dist/esm/icons/cloud-fog.js';
import CloudLightning from 'lucide/dist/esm/icons/cloud-lightning.js';
import CloudMoon from 'lucide/dist/esm/icons/cloud-moon.js';
import CloudRain from 'lucide/dist/esm/icons/cloud-rain.js';
import CloudSnow from 'lucide/dist/esm/icons/cloud-snow.js';
import CloudSun from 'lucide/dist/esm/icons/cloud-sun.js';
import Container from 'lucide/dist/esm/icons/container.js';
import Download from 'lucide/dist/esm/icons/download.js';
import GitBranch from 'lucide/dist/esm/icons/git-branch.js';
import Github from 'lucide/dist/esm/icons/github.js';
import Images from 'lucide/dist/esm/icons/images.js';
import Moon from 'lucide/dist/esm/icons/moon.js';
import NotebookPen from 'lucide/dist/esm/icons/notebook-pen.js';
import Package from 'lucide/dist/esm/icons/package.js';
import Rss from 'lucide/dist/esm/icons/rss.js';
import Server from 'lucide/dist/esm/icons/server.js';
import ShieldCheck from 'lucide/dist/esm/icons/shield-check.js';
import Sun from 'lucide/dist/esm/icons/sun.js';
import SunMoon from 'lucide/dist/esm/icons/sun-moon.js';
import Newspaper from 'lucide/dist/esm/icons/newspaper.js';
import MessagesSquare from 'lucide/dist/esm/icons/messages-square.js';
const common = {
  Activity,
  ArrowUpRight,
  Bell,
  Bookmark,
  Box,
  Cloud,
  CloudFog,
  CloudLightning,
  CloudMoon,
  CloudRain,
  CloudSnow,
  CloudSun,
  Container,
  Download,
  GitBranch,
  Github,
  Images,
  Moon,
  NotebookPen,
  Package,
  Rss,
  Server,
  ShieldCheck,
  Sun,
  SunMoon,
  Newspaper,
  MessagesSquare,
};
let full, pending;
const name = (value) =>
  value.replace(
    /(\w)(\w*)(_|-|\s*)/g,
    (_, first, rest) => first.toUpperCase() + rest.toLowerCase(),
  );
function render(icons) {
  let missing = false;
  for (const placeholder of document.querySelectorAll('i[data-lucide]')) {
    const definition = icons[name(placeholder.dataset.lucide)];
    if (!definition) {
      missing = true;
      continue;
    }
    const [tag, attrs, children] = definition;
    const own = Object.fromEntries([...placeholder.attributes].map((a) => [a.name, a.value]));
    placeholder.replaceWith(
      createElement([
        tag,
        { ...attrs, ...own, class: `lucide ${own.class || ''}`.trim() },
        children,
      ]),
    );
  }
  return missing;
}
window.lucide = {
  createIcons() {
    if (render(full || common) && !full && !pending)
      pending = import('lucide')
        .then((module) => {
          full = module.icons;
          render(full);
        })
        .catch(() => {})
        .finally(() => {
          pending = null;
        });
  },
};

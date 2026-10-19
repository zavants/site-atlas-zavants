// Proceso hijo para la prueba de escrituras simultáneas: crea N etiquetas en el sitio dado.
import { mutate } from '../../src/model/service.js';
import { SiteStore } from '../../src/store/store.js';

const [home, site, count, label] = process.argv.slice(2);
const store = new SiteStore(home);
for (let i = 0; i < Number(count); i++) await mutate(store, site!, { type: 'createTag', name: `${label}-${i}` });

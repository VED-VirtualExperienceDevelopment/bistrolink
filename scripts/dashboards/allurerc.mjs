// BL-487: configuración del reporte Allure de los E2E (Allure 3).
//
// Lo usa el job «Merge + reporte E2E» de ci.yml:
//   npx allure generate <resultados> -c scripts/dashboards/allurerc.mjs -o <salida>
//
// Se usa el plugin «allure2» (la vista clásica de Allure) porque es el único
// que respeta ALLURE_NO_ANALYTICS=true: la vista por defecto de Allure 3 agrega
// un script de Google Analytics a la página, y el reporte se publica en
// GitHub Pages para que lo vea cualquiera. El job define esa variable.
//
// ALLURE_REPORT_NAME (opcional): nombre del reporte, con la versión del build.

const nombre = process.env.ALLURE_REPORT_NAME?.trim() || "BistroLink — E2E";

export default {
  name: nombre,
  plugins: {
    allure2: {
      options: {
        reportName: nombre,
        reportLanguage: "es",
      },
    },
  },
};

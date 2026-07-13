import type { Strings } from './types';

/** Diccionario en español. */
export const es: Strings = {
  common: {
    siteName: 'Shvil List',
    tagline: 'Tú lo registras, tú lo acreditas — el espacio de registro y prueba del caminante',
    nav: {
      courses: 'Registro de rutas',
      claims: 'Tablón de reclamos',
      certificates: 'Galería de finalizadores',
      leaderboard: 'Top 100',
    },
    footer: {
      angelLink: 'Shvil Ángel — mapa de ángeles y mercado de monedas (shvilangel.org)',
      angelUrl: 'https://shvilangel.org',
      motto: 'Tú lo registras, tú lo acreditas.',
    },
    serverUnreachable:
      'No se puede conectar con el servidor del directorio. Inténtalo de nuevo en un momento.',
    loading: 'Cargando…',
    langLabel: 'Idioma',
  },

  home: {
    heroTitle: 'Tú lo registras, tú lo acreditas',
    vision:
      'La moneda Shvil nace de los pasos sobre las rutas de peregrinación. Ningún servidor la ' +
      'emite: mientras caminas una ruta registrada, se forma dentro de tu propio teléfono. ' +
      'Shvil List es el espacio de registro y prueba de esos pasos: se inscriben rutas, se ' +
      'certifican finalizaciones y la comunidad recupera juntos los pasos que quedaron sin ' +
      'registrar. No hay un servidor que vigile — quien vela es siempre la comunidad.',
    downloadCta: 'Descargar la billetera',
    downloadNote: 'Aplicación en preparación — se abre pronto.',
    proofTitle: 'Pruebas de travesía — acreditación sin ubicación',
    proofBody:
      'Aquí se publican los resúmenes de prueba de caminata que tú decides hacer públicos en la ' +
      'aplicación. Solo se muestran distancia, número de pasos y fecha — la ubicación y el ' +
      'recorrido nunca se registran, ni en el teléfono ni en el servidor, así que tampoco pueden mostrarse.',
    proofComingSoon: 'La consulta pública de las pruebas de travesía está en preparación — se abrirá en una próxima actualización.',
    sectionsTitle: 'Qué puedes hacer aquí',
    sections: {
      courses: {
        title: 'Registro de rutas',
        desc: 'Rutas oficiales y candidatas, con el avance hacia las 100 finalizaciones.',
      },
      claims: {
        title: 'Tablón de reclamos',
        desc: 'El procedimiento comunitario para recuperar pasos que la aplicación no registró.',
      },
      certificates: {
        title: 'Galería de finalizadores',
        desc: 'Certificados de finalización y de tramo, con las cifras de emisión de monedas de ánimo.',
      },
      leaderboard: {
        title: 'Clasificación Top 100',
        desc: 'El salón de la fama de los senderistas verificados — la línea base viva del sistema.',
      },
    },
  },

  courses: {
    title: 'Registro de rutas',
    intro:
      'Solo los pasos sobre rutas inscritas como caminos de peregrinación se convierten en monedas ' +
      'a la tasa base (1 km = 1 SHV). Este es el registro oficial de esas rutas.',
    officialTitle: 'Rutas oficiales',
    officialEmpty: 'Aún no hay rutas oficiales inscritas.',
    colName: 'Nombre de la ruta',
    colSegments: 'Tramos',
    colDifficulty: 'Factor de dificultad',
    segmentsValue: (n) => `${n} tramo${n === 1 ? '' : 's'}`,
    difficultyValue: (v) => `×${v}`,
    candidateTitle: 'Rutas candidatas (a la espera de promoción)',
    candidateEmpty: 'Por ahora no hay rutas candidatas propuestas.',
    progressLabel: (n, threshold) => `actualmente ${n} de ${threshold} caminantes`,
    candidateNoMint:
      'Las rutas candidatas no generan monedas. La generación comienza solo cuando 100 o más registros de finalización promueven la ruta a oficial.',
    submitInApp: 'Proponer una nueva ruta y enviar registros de finalización se hace en la aplicación de billetera.',
    statusOfficial: 'Oficial',
    statusCandidate: 'Candidata',
  },

  claims: {
    title: 'Tablón de reclamos',
    intro:
      'El procedimiento de recuperación para pasos realmente caminados que no produjeron monedas — ' +
      'la aplicación quedó apagada o hubo un error. Cuando la comunidad revisa y reconoce un ' +
      'reclamo, la clave emisora de reclamos del sitio firma una concesión por los SHV correspondientes.',
    readOnlyNote:
      'Esta página es de solo lectura. Presentar reclamos y votar el reconocimiento se hace en la aplicación de billetera, y solo pueden participar usuarios con identidad verificada.',
    filterAll: 'Todos',
    filterOpen: 'En revisión',
    filterApproved: 'Aprobados',
    colCourse: 'Ruta',
    colDistance: 'Distancia',
    colDate: 'Fecha de la caminata',
    colPhotos: 'Fotos',
    colVotes: 'Votos de reconocimiento',
    colStatus: 'Estado',
    photosValue: (n) => `${n}`,
    votesValue: (n, threshold) => `${n} / ${threshold}`,
    statusLabel: (status) =>
      status === 'OPEN' ? 'En revisión' : status === 'APPROVED' ? 'Aprobado' : status,
    empty: 'No hay reclamos que mostrar.',
    rulesTitle: 'Reglas de los reclamos',
    rule24h: 'Solo son válidos los reclamos presentados dentro de las 24 horas posteriores a la caminata.',
    ruleMonthly: 'Los reclamos están limitados a 2 por persona al mes.',
    ruleVoters: 'Los votos de reconocimiento están abiertos solo a usuarios con identidad verificada, un voto por persona.',
    issuanceTitle: 'Publicación de la emisión por reclamos',
    issuanceApproved: (n, shv) => `Reclamos aprobados: ${n} (total emitido ${shv})`,
    issuanceOpen: (n) => `Reclamos en revisión: ${n}`,
  },

  certificates: {
    title: 'Galería de finalizadores',
    intro:
      'Quien comparte información construye la comunidad. Publica fotos de finalización y datos de ' +
      'la travesía, y el sitio emite monedas de ánimo. Estos registros también sirven a la revisión ' +
      'de promoción de rutas candidatas y a los votos de reconocimiento de reclamos.',
    rewardNote:
      'Monedas de ánimo: certificado de finalización de ruta 10 SHV · certificado de tramo 3 SHV. Sin recompensa duplicada por la misma ruta (una por persona y ruta). Promoción limitada en período y volumen total.',
    filterLabel: 'Ruta',
    filterAll: 'Todas las rutas',
    kindFull: 'Finalización (10 SHV)',
    kindSection: 'Tramo (3 SHV)',
    photosValue: (n) => `${n} foto${n === 1 ? '' : 's'}`,
    empty: 'Aún no se han publicado certificados.',
    submitInApp: 'La presentación de certificados de finalización se hace en la aplicación de billetera.',
    issuanceTitle: 'Publicación de la emisión de monedas de ánimo',
    issuanceStats: (n, shv) => `Monedas de ánimo emitidas: ${n} (total ${shv})`,
  },

  leaderboard: {
    title: 'Senderistas verificados — Top 100',
    intro:
      'El salón de la fama regional de senderistas con insignia de verificación. Con su consentimiento expreso, solo se publican la distancia acumulada y el total de monedas generadas.',
    noLocationNote:
      'No hay datos de ubicación — solo la distancia y los totales son públicos, y los recorridos nunca se registran en ninguna parte.',
    regionLabel: 'Región',
    regionAll: 'Todas las regiones',
    colRank: 'Puesto',
    colName: 'Nombre',
    colRegion: 'Región',
    colDistance: 'Distancia',
    colMinted: 'Total generado',
    verifiedBadge: 'Verificado',
    distanceValue: (km) => `${km} km`,
    empty: 'Aún no hay senderistas inscritos.',
    baselineTitle: 'Línea base del límite humano',
    baselineDaily: (shv) => `Tope de generación diaria: ${shv}`,
    baselineWeekly: (shv) => `Techo de plausibilidad semanal: ${shv}`,
    baselineRegionRow: (region, shv, members) =>
      `${region} — ${members} senderista${members === 1 ? '' : 's'} verificado${members === 1 ? '' : 's'}, máximo total generado ${shv}`,
    baselineCatch: 'Cualquier generador que supere esta línea base es detectado automáticamente.',
    flaggedTitle: 'Explicaciones pendientes',
    flaggedCount: (n) => `A la espera de explicación: ${n}`,
    flaggedNote:
      'Recuento anónimo. Se levanta al aceptarse la explicación; las monedas legítimas ya en circulación y las transacciones de otras personas no se ven afectadas.',
  },
};

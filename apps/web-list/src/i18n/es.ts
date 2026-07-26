import type { Strings } from './types';

/** Diccionario en español. */
export const es: Strings = {
  common: {
    siteName: 'Shvilist',
    tagline:
      'El hogar de los shvilists — caminantes que acuñan monedas mientras viajan. Tú lo registras, tú lo acreditas.',
    nav: {
      angels: 'Buscar un ángel',
      trailAngels: 'Ángeles del INT',
      companions: 'Buscar compañeros',
      spots: 'Tesoros de sitio',
      courses: 'Registro de rutas',
      claims: 'Tablón de reclamos',
      certificates: 'Galería de finalizadores',
      verify: 'Verificador de monedas',
      leaderboard: 'Top 100',
      transparency: 'Transparencia',
    },
    footer: {
      angelLink: 'Shvil Ángel — mapa de ángeles y mercado de monedas (shvilangel.org)',
      angelUrl: 'https://www.shvilangel.org',
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
      'Shvilist es el hogar de esos caminantes que crean monedas mientras viajan: se inscriben ' +
      'rutas, se certifican finalizaciones y la comunidad recupera juntos los pasos que quedaron sin ' +
      'registrar. No hay un servidor que vigile — quien vela es siempre la comunidad. ' +
      '(Las guías detalladas de rutas son un servicio aparte, Shvil List.)',
    downloadCta: 'Descargar la billetera',
    downloadNote: 'Piloto cerrado en curso — la versión de prueba para Android se abrirá tras las pruebas de campo.',
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

  angels: {
    title: 'Buscar un ángel',
    intro:
      'A lo largo del sendero hay casas que abren su puerta a quienes caminan. La base es la ' +
      'buena voluntad — la moneda es solo un medio para dar las gracias y mantener vivo el ' +
      'círculo de las buenas obras. Encuentra a los ángeles cercanos a tu ruta y planifica ' +
      'dónde descansarás.',
    filterTitle: 'Filtros de servicios',
    filters: {
      bedRoom: 'Habitación',
      bedSofa: 'Sofá',
      bedTent: 'Tienda en el patio',
      internet: 'Internet',
      shower: 'Ducha',
      meal: 'Comida',
    },
    angelCount: (n) => `${n} ángel${n === 1 ? '' : 'es'}`,
    bedRoomCount: (n) => `Habitación ×${n}`,
    bedSofaCount: (n) => `Sofá ×${n}`,
    bedTentCount: (n) => `Tienda en el patio ×${n}`,
    capacity: (n) => `Capacidad: ${n} huésped${n === 1 ? '' : 'es'}`,
    conditionsLabel: 'Condiciones de acogida',
    availableBadge: 'Recibe huéspedes ahora',
    unavailableBadge: 'No recibe huéspedes por ahora',
    approxLocation:
      'Esta es una ubicación aproximada — la ubicación exacta se comparte por mensaje de la billetera después de que el ángel apruebe la solicitud.',
    requestCta: 'Solicitar alojamiento desde la aplicación de billetera',
    requestNote:
      'Se abre en un dispositivo con la billetera Shvil instalada. Las solicitudes se envían solo desde la billetera — este sitio es para consultar y planificar.',
    selectHint: 'Toca un marcador del mapa para ver el perfil del ángel.',
    guestbookTitle: 'Libro de visitas',
    guestbookCount: (n) => `Libro de visitas · ${n} tarjeta${n === 1 ? '' : 's'}`,
    guestbookEmpty: 'Aún no hay tarjetas de agradecimiento aquí.',
    ratingTitle: 'Valoración',
    ratingSummary: (avg, count, ratioPercent) =>
      `★ ${avg} (${count} valoración${count === 1 ? '' : 'es'}, ${ratioPercent}% públicas)`,
    ratingNone: 'Aún no ha recibido valoraciones',
    ratingDisclaimer: 'Solo de referencia — no es una puntuación verificada (la publica el titular del perfil).',
  },

  companions: {
    title: 'Buscar compañeros',
    intro:
      'Un espacio para compartir tu viaje y conocer, antes de partir, a las personas con quienes ' +
      'caminarás. En lugar de caminar en solitario, un equipo de tres o cuatro se apoya en el sendero ' +
      'y encuentra alojamiento con más facilidad; las personas están antes que las monedas. Revisa los ' +
      'tramos, las fechas y los tamaños de equipo para encontrar un viaje afín al tuyo.',
    readOnlyNote:
      'Este sitio es para consultar y planificar. Publicar un aviso de compañía y enviar interés se hacen en la aplicación de billetera, que guarda tu clave de firma.',
    teamNote: 'Se recomiendan equipos de 3–4 — caminar juntos genera confianza y facilita el alojamiento (por la experiencia de Daniel).',
    filterTitle: 'Región',
    filterAllRegions: 'Todas las regiones',
    filterOpen: 'Reclutando',
    filterAll: 'Todos',
    count: (n) => `${n} reclutando`,
    modeWalk: '🚶 A pie',
    modeBike: '🚲 En bici',
    dateRange: (from, to) => `🗓 ${from} – ${to}`,
    partyValue: (current, target) => `👥 ${current} / ${target}`,
    recommendedBadge: 'Tamaño recomendado',
    closedBadge: 'Cerrado',
    contactCta: 'Enviar interés desde la billetera',
    contactNote:
      'Se abre en un dispositivo con la billetera Shvil instalada. El interés y el contacto ocurren solo en la billetera — un mensaje cifrado de extremo a extremo al autor.',
    postInApp: 'Publica un aviso de compañía desde la aplicación de billetera (Más → Buscar compañeros → Nueva publicación).',
    empty: 'Aún no hay publicaciones de compañía reclutando. Publica la primera desde la billetera.',
  },

  legacyAngels: {
    title: 'Ángeles del sendero veteranos (INT)',
    intro:
      'La lista pública de ángeles del sendero que la comunidad de caminantes del Sendero Nacional ' +
      'de Israel mantiene desde hace décadas. Estos anfitriones no son miembros de Shvil — es una ' +
      'lista de referencia; sigue las notas originales para contacto y cortesía. Ordenada de norte (Dan) a sur (Eilat).',
    etiquette: 'Cortesía: contacta al menos 48 horas antes de llegar, no llames después de las 21:00 y deja el lugar ordenado.',
    shoBadge: 'Observa el sabbat',
    shoNote: 'SHO = hogar que observa el sabbat y las festividades judías — no llamar desde la puesta de sol del viernes hasta el sábado tras la puesta de sol.',
    source: 'Fuente',
    updated: (date) => `Última actualización del original: ${date}`,
    count: (n) => `${n} ángeles · lista de referencia`,
    serviceLabels: {
      SLEEP: 'Dormir',
      SHOWER: 'Ducha',
      MEAL: 'Comidas',
      LAUNDRY: 'Lavandería',
      INTERNET: 'Internet',
      GROCERY: 'Víveres',
      KITCHEN: 'Cocina',
      PICKUP: 'Recogida/entrega',
      WATER: 'Agua',
      MAIL: 'Correo',
    },
  },
  trust: {
    title: 'Historial verificado',
    walkTier: (tier) =>
      tier === 'VETERAN'
        ? 'Caminante veterano'
        : tier === 'EXPERIENCED'
          ? 'Caminante experimentado'
          : 'Empezó a caminar',
    claimsApproved: (n) => `${n} recorrido${n === 1 ? '' : 's'} verificado${n === 1 ? '' : 's'} por la comunidad`,
    certificatesFull: (n) => `${n} certificado${n === 1 ? '' : 's'} de sendero completo`,
    certificatesSection: (n) => `${n} certificado${n === 1 ? '' : 's'} de tramo`,
    memberSince: (day) => `Activo desde ${day}`,
    guestbookCards: (n) => `${n} tarjeta${n === 1 ? '' : 's'} de agradecimiento`,
    firstHosting: 'Ha alojado',
    verified: 'Verificado por revisores',
    none: 'Aún no hay historial público.',
    ratingIsReference: 'Las estrellas son solo una referencia — la confianza se basa en hechos verificables.',
  },

  spots: {
    title: 'Tesoros de sitio',
    intro:
      'Negocios junto al sendero — cafés, hospedajes, gasolineras — esconden monedas en su puerta para ' +
      'recibir a quienes caminan. Un negocio no puede emitir: solo redistribuye monedas que compró o ganó, ' +
      'depositándolas (quemándolas) para que el servidor las reparta por orden de llegada. Aquí solo ' +
      'aparecen los sitios que aún tienen monedas — decide sobre la marcha si vale la pena el desvío.',
    readOnlyNote:
      'Este sitio es para consultar y planificar. La recogida se hace en la aplicación de billetera, que escanea el QR del sitio y firma — las monedas se entregan solo a miembros verificados (sin vale al portador).',
    filterTitle: 'Región',
    filterAllRegions: 'Todas las regiones',
    count: (n) => `${n} sitio${n === 1 ? '' : 's'}`,
    perClaim: (shv) => `${shv} por persona`,
    remaining: (remaining, total) => `Quedan ${remaining} de ${total}`,
    scale: (shv) => `Fondo ${shv}`,
    until: (date) => `Hasta ${date}`,
    presenceBadge: '🚶 Verificación a pie en el lugar — hay que estar allí para recibir',
    selectHint: 'Toca un marcador del mapa para ver el sitio.',
    getInApp: 'Recoger en la aplicación de billetera',
    getNote:
      'Se abre en un dispositivo con la billetera Shvil instalada. La recogida es por orden de llegada, una por persona — el servidor cuenta los cupos, así que las monedas nunca superan lo que el negocio depositó.',
    empty: 'No hay sitios con fondos ahora mismo. Los sitios sin monedas no aparecen en el mapa.',
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

  transparency: {
    title: 'Transparencia',
    intro:
      'Shvil no tiene libro mayor central. En su lugar, para que la comunidad pueda velar por sí misma, el sitio publica todo lo que ha emitido y liquidado, junto con las estadísticas de sincronización.',
    estimateNote:
      'Las estadísticas de acuñación son estimaciones basadas en datos de sincronización de dispositivos — las monedas se crean en el teléfono de cada persona, y el servidor ni aprueba ni impone informes.',
    promoTitle: 'Emisión promocional (bono de ángel)',
    promoRegistration: (issued, quota) =>
      `Bono de registro (20 SHV): ${issued} emitidos de un cupo de ${quota}`,
    promoFirstHosting: (issued) => `Bono de primera acogida (30 SHV): ${issued} emitidos`,
    promoRule:
      'Los bonos de ángel se emiten con una clave de firma limitada en período y cantidad, y la acuñación ocurre en el teléfono del ángel.',
    marketTitle: 'Liquidaciones y comisiones acumuladas del mercado',
    marketOpen: (n) => `Listados abiertos: ${n}`,
    marketSettled: (n, shv) => `Listados liquidados: ${n} (total ${shv})`,
    marketFees: (usdc, pct) => `Comisiones acumuladas: ${usdc} (${pct} al liquidar)`,
    marketNote:
      'Los pagos cara a cara dentro del ecosistema son gratuitos, para siempre — la comisión se aplica solo a las liquidaciones del mercado.',
    mintStatsTitle: 'Monedas caminadas frente a monedas compradas',
    mintStatsPlaceholder:
      'En preparación — las monedas acuñadas caminando y las compradas en el mercado se distinguen permanentemente por su linaje, y las cifras se publicarán aquí a medida que se acumule la sincronización.',
    regionalTitle: 'Tendencias de acuñación por región',
    regionalPlaceholder:
      'En preparación — el volumen de acuñación por región (por ruta, no por ubicación) se publicará aquí. El recorrido de nadie se registra jamás en ninguna parte.',
    reserveTitle: 'Divulgación de la reserva',
    reservePlaceholder:
      'En preparación — los principios de gestión de la reserva y su estado se publicarán aquí.',
  },

  region: {
    label: 'Región',
    selectAria: 'Seleccionar región de la ruta',
    current: (name) => `Región actual: ${name}`,
    liveBadge: 'Activa',
    comingSoonBadge: 'Próximamente',
    comingSoonNotice: (name) => `${name} — se abre pronto.`,
    expandVision: (count) =>
      `Empezamos por el Sendero Nacional de Israel. Desde allí nos expandimos a rutas en ${count} países.`,
    expandTitle: 'Rutas que se abren próximamente',
    expandIntro: 'Regiones que se preparan para abrir a la acuñación y la acogida de ángeles:',
    countries: {
      IL: 'Israel',
      ES: 'España',
      PE: 'Perú',
      NP: 'Nepal',
      CL: 'Chile',
      FR: 'Francia',
      NZ: 'Nueva Zelanda',
      US: 'Estados Unidos',
      TZ: 'Tanzania',
    },
  },
  verify: {
    title: 'Verificador de monedas',
    intro:
      'Sube una moneda para saber si se formó de verdad o fue clonada. Más allá de las firmas, comprobamos si los hechos físicos que lleva la moneda — distancia, pasos, tiempo — se contradicen entre sí, y si realmente pasó tiempo entre las monedas. Un programa de clonación no puede fabricar el tiempo entre formaciones de monedas.',
    privacyNote: 'Todo se ejecuta dentro de este navegador. Tus monedas no se envían a ninguna parte.',
    download: {
      title: 'Descarga el verificador',
      body:
        'El verificador es un solo archivo. Descárgalo y guárdalo en tu propio dispositivo. Aunque ' +
        'este sitio desaparezca, y aunque no tengas internet, abrir ese archivo te da la misma ' +
        'verificación. No verificamos monedas por ti: te entregamos la herramienta que verifica.',
      cta: 'Descargar el verificador (un archivo HTML)',
      offlineHint:
        'Guarda el archivo y ábrelo en cualquier navegador. Funciona en modo avión, y eso es la ' +
        'prueba de que esta verificación termina en tu propio dispositivo.',
      communityNote:
        'Las reglas del veredicto son públicas y cualquiera puede leerlas. El verificador no es un ' +
        'servicio que nosotros operemos: es una herramienta que pertenece a la comunidad; quien ' +
        'descubra una nueva técnica de falsificación puede añadir una regla y reforzar su propio ' +
        'verificador.',
      langNote: 'El verificador descargable está actualmente en coreano.',
    },
    effort: {
      title: 'Cuán a fondo verificar lo decides tú',
      body:
        'No te obligamos a verificar ni decidimos por ti. Si no pierdes nada por no verificar, no ' +
        'verifiques. Cuanto mayor sea la pérdida posible, más a fondo conviene verificar; ese ' +
        'umbral es tuyo.',
      lowStake: 'Cantidades pequeñas: acéptalas sin más. Verificar no es una obligación.',
      highStake:
        'Si pagas dinero real o recibes una cantidad grande, no mires una sola moneda: verifica ' +
        'juntas todas las monedas de la otra parte. La distancia de tiempo entre monedas solo ' +
        'aparece cuando se examinan varias a la vez.',
    },
    limits: {
      title: 'Lo que este verificador no puede hacer',
      items: [
        '«Sin contradicciones» no prueba que sea auténtica: significa que nada quedó atrapado por las comprobaciones que este verificador conoce.',
        'No verifica la identidad del emisor ni la integridad del dispositivo: funciona sin lista de claves de confianza, así que solo comprueba que las firmas sean coherentes entre sí.',
        'La comprobación de la distancia de tiempo entre monedas solo funciona con dos o más monedas. Una sola moneda reduce mucho el alcance del análisis.',
        'No puede saber si esta moneda ya se gastó en otro lugar. Solo detecta que una misma moneda se bifurque dentro del lote que has enviado.',
        'Los indicios estadísticos nunca suman un veredicto de falsificación, por muchos que se acumulen. Un indicio es motivo para pedir una explicación, nunca para condenar a una persona.',
      ],
    },
    pastePlaceholder: 'Pega el JSON de una moneda, una exportación de billetera o un QR de pago (SHV1.…)',
    uploadLabel: 'Subir archivo',
    checkButton: 'Verificar',
    clearButton: 'Limpiar',
    verdicts: { FORGED: 'Falsificada', SUSPECT: 'Sospechosa', AUTHENTIC: 'Sin contradicciones', INCONCLUSIVE: 'No concluyente' },
    summaryTitle: 'Veredicto',
    findingsTitle: 'Hallazgos',
    notesTitle: 'No verificado',
    serialsTitle: 'Números de serie',
    statsLine: (proofs, grants, totalShv) => `${proofs} pruebas de caminata · ${grants} monedas de bono · total ${totalShv}`,
    fatalBadge: 'Físicamente imposible',
    unprovenBadge: 'Elegibilidad no probada',
    signalBadge: 'Indicio',
    detailsLangNote: 'Las explicaciones detalladas se generan actualmente en coreano.',
    errorPrefix: 'No se pudo leer la entrada',
  },
};

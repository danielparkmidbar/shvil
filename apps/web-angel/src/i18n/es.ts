import type { Strings } from './types';

/** Diccionario en español. */
export const es: Strings = {
  common: {
    siteName: 'Shvil Ángel',
    tagline: 'Hogares de ángeles — el mapa de quienes acogen a los peregrinos',
    nav: {
      become: 'Ser ángel',
      map: 'Ángeles vecinos',
      market: 'Mercado de monedas',
      transparency: 'Transparencia',
    },
    footer: {
      shvilistLink: 'Shvilist — el hogar de los caminantes (shvilist.org)',
      shvilistUrl: 'https://www.shvilist.org',
      faceToFaceFree: 'Los pagos cara a cara dentro del ecosistema son gratuitos, para siempre.',
    },
    serverUnreachable:
      'No se puede conectar con el servidor del directorio. Inténtalo de nuevo en un momento.',
    loading: 'Cargando…',
    langLabel: 'Idioma',
  },

  landing: {
    heroTitle: 'Abre tu casa, y tú también podrás descansar en otro lugar',
    vision:
      'La moneda Shvil nace de los pasos sobre las rutas de peregrinación. Ningún servidor la ' +
      'imprime: mientras el peregrino camina una ruta registrada, se forma dentro de su propio ' +
      'teléfono, y se intercambia por la cama, la comida y la ducha que un ángel ofrece al ' +
      'borde del camino. Si abres tu casa, podrás alojarte en la casa de otra persona en otro ' +
      'lugar. En el lado opuesto de alquilar casas por dinero, el caminar y la hospitalidad se ' +
      'corresponden mutuamente en un ciclo de reciprocidad.',
    becomeCta: 'Ser ángel',
    mapPreviewCta: 'Ver los ángeles vecinos',
    downloadCta: 'Descargar la billetera',
    downloadNote: 'Aplicación en preparación — se abre pronto.',
    flowTitle: 'El camino para ser ángel',
    flowSteps: [
      'En «Ser ángel», elige tu sendero, escribe tu pueblo o dirección y mira tu pin en el mapa.',
      'Esboza lo que podrías ofrecer: habitación, sofá, tienda en el patio, comidas, ducha.',
      'Instala la aplicación de billetera Shvil. La billetera es también un mensajero, y solo la billetera puede firmar tu registro.',
      'Termina el registro en la billetera: tu punto aparece en el mapa de ángeles vecinos y los peregrinos del camino llaman con un mensaje.',
    ],
    flowNote:
      'Este sitio es la puerta. Todo lo que viene después de unirte — solicitudes, aprobaciones, gratitud — fluye por la billetera, y puedes activar y desactivar tu visibilidad cuando quieras.',
    faceToFaceFree:
      'Un pago cara a cara entre peregrino y ángel no necesita aprobación de servidor ni tiene comisión — los pagos dentro del ecosistema son gratuitos, para siempre.',
  },

  map: {
    title: 'Ángeles vecinos',
    intro:
      'Los vecinos que abren su casa a lo largo del sendero contigo. Solo se muestran el apodo y los servicios ofrecidos — las ubicaciones son aproximadas, en una cuadrícula de ~1 km.',
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
    selectHint: 'Toca un marcador del mapa para ver el apodo y los servicios del ángel.',
    pilgrimNotice: '¿Caminas el sendero y buscas un ángel? La búsqueda y las solicitudes para peregrinos están en',
    guestbookTitle: 'Libro de visitas',
    guestbookCount: (n) => `Libro de visitas · ${n} tarjeta${n === 1 ? '' : 's'}`,
    guestbookEmpty: 'Aún no hay tarjetas de agradecimiento aquí.',
    ratingTitle: 'Valoración',
    ratingSummary: (avg, count, ratioPercent) =>
      `★ ${avg} (${count} valoración${count === 1 ? '' : 'es'}, ${ratioPercent}% públicas)`,
    ratingNone: 'Aún no ha recibido valoraciones',
    ratingDisclaimer: 'Solo de referencia — no es una puntuación verificada (la publica el titular del perfil).',
  },

  become: {
    title: 'Ser ángel',
    intro:
      'Abrir tu casa empieza aquí. Esta página es solo la puerta: prueba tu ubicación y tus servicios, y completa el registro real en la billetera. Nada de lo que escribas aquí se envía a ningún servidor.',
    stepAddressTitle: '¿Dónde está tu casa? (pueblo o dirección)',
    addressPlaceholder: 'Pueblo, ciudad o dirección',
    addressHint: 'Escribe al menos 3 caracteres — las sugerencias aparecen al hacer una pausa.',
    searching: 'Buscando…',
    noResults: 'No se encontraron lugares. Prueba con el nombre de un pueblo o ciudad cercanos.',
    searchFailed:
      'La búsqueda de direcciones no está disponible ahora. Aún puedes tocar el mapa para colocar el pin y arrastrarlo.',
    stepPinTitle: 'Ajusta el pin',
    pinDragHint: 'Toca el mapa para colocar el pin y arrástralo para afinar.',
    pinPrivacyNote:
      'El mapa público muestra solo una ubicación aproximada en una cuadrícula de ~1 km. Tu ubicación exacta se entrega solo por mensaje de la billetera, y solo a los huéspedes cuya estancia hayas aprobado.',
    publicPreviewLegend: 'El círculo translúcido es la posición aproximada que se mostraría públicamente.',
    stepServicesTitle: '¿Qué puedes ofrecer?',
    servicesNote: 'Solo una vista previa — la oferta real se registra, y se cambia cuando quieras, en la billetera.',
    bedLabel: 'Lugar para dormir',
    capacityLabel: 'Capacidad (huéspedes)',
    capacityAutoNote: 'Se calcula automáticamente como la suma de los lugares para dormir de arriba.',
    stepWalletTitle: 'Completa tu registro en la billetera',
    walletCta: 'Descargar la billetera',
    walletComingSoon: 'Aplicación en preparación — se abre pronto.',
    notSentNote:
      'Todo lo que escribiste aquí queda en este navegador y no se envió a ningún servidor de Shvil — solo el texto de búsqueda de dirección se envía al servicio de geocodificación Photon, únicamente para encontrar sugerencias. El registro lo firma únicamente la billetera.',
  },

  market: {
    title: 'Mercado de monedas',
    intro:
      'Los ángeles que no viajan ponen aquí las monedas recibidas por su hospitalidad. El pago se realiza en la moneda estable en dólares acordada.',
    noPriceBanner: 'Este mercado no tiene columna de precio.',
    noPriceDetail:
      'El precio lo propone el comprador — listados sin precio. El ángel publica solo una cantidad y decide si acepta la oferta del comprador.',
    colSeller: 'Vendedor (ángel)',
    colAmount: 'Cantidad',
    colListedAt: 'Fecha de publicación',
    colPrice: 'Precio',
    priceCell: 'Propuesta del comprador',
    empty: 'Ahora mismo no hay listados abiertos.',
    feeNote:
      'La comisión del mercado es del 2,5% al cerrarse la operación (fondos operativos, publicada en la página de Transparencia).',
    faceToFaceFree:
      'Que un peregrino pague directamente a un ángel en el camino es siempre, y para siempre, gratuito.',
    appFlowNote:
      'La propuesta de precio, la aprobación y el depósito en garantía (escrow) se realizan en la aplicación de billetera Shvil. Esta página solo muestra los listados abiertos.',
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
};

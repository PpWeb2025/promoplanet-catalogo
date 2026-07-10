// server/categorias.js
// Landing pages SEO. Cada entrada define la URL pública (slug), el tipo de
// filtro que aplica sobre los productos y el contenido de la página.
// tipo: 'categoria' filtra por p.categoria === filtro
//       'ocasion'   filtra por p.ocasiones.includes(filtro)
//       'badge'     filtra por p.badges.includes(filtro)

const LANDINGS = [
  {
    slug: 'drinkware',
    tipo: 'categoria',
    filtro: 'drinkware',
    h1: 'Drinkware personalizado para empresas',
    title: 'Drinkware personalizado para empresas — Botellas, vasos y mates | PromoPlanet',
    description: 'Botellas térmicas, vasos, tazas y mates personalizados con logo para empresas. Regalos corporativos de drinkware con entrega en todo el país.',
    intro: [
      'El drinkware es la categoría más elegida en regalos corporativos: botellas térmicas, vasos con tapa, tazas y mates que se usan todos los días y mantienen la marca a la vista.',
      'La línea incluye opciones de acero inoxidable con doble pared, vidrio con funda protectora y materiales sustentables como bambú y fibra de trigo. Todos los productos admiten personalización con logo mediante grabado láser o serigrafía, con mínimos accesibles para kits de onboarding, eventos y regalos de fin de año.'
    ]
  },
  {
    slug: 'bolsos-y-mochilas',
    tipo: 'categoria',
    filtro: 'bolsos_mochilas',
    h1: 'Mochilas y bolsos personalizados con logo',
    title: 'Mochilas y bolsos personalizados con logo para empresas | PromoPlanet',
    description: 'Mochilas, bolsos, morrales y tote bags personalizados para empresas. Ideales para kits de bienvenida, eventos corporativos y regalos de fin de año.',
    intro: [
      'Las mochilas y bolsos corporativos combinan uso diario con alta visibilidad de marca: acompañan a quien los recibe en la oficina, en viajes y en el tiempo libre.',
      'La categoría abarca mochilas urbanas y porta notebook, morrales, bolsos de viaje y tote bags de algodón o materiales reciclados. Se personalizan con bordado, serigrafía o transfer según el material, y funcionan tanto como pieza central de un kit de onboarding como regalo institucional para eventos y capacitaciones.'
    ]
  },
  {
    slug: 'escritura',
    tipo: 'categoria',
    filtro: 'escritura',
    h1: 'Bolígrafos y artículos de escritura personalizados',
    title: 'Bolígrafos personalizados con logo para empresas | PromoPlanet',
    description: 'Bolígrafos, lápices, marcadores y sets de escritura personalizados con logo. El clásico del merchandising corporativo, con mínimos accesibles.',
    intro: [
      'Los artículos de escritura son el punto de entrada clásico del merchandising: bajo costo unitario, mínimos accesibles y presencia constante en escritorios y reuniones.',
      'La línea incluye bolígrafos metálicos y de materiales sustentables, lápices, marcadores y sets de escritura para regalos de mayor jerarquía. La personalización con logo se realiza por grabado láser o tampografía, según el producto.'
    ]
  },
  {
    slug: 'tecnologia',
    tipo: 'categoria',
    filtro: 'tecnologia',
    h1: 'Regalos tecnológicos personalizados',
    title: 'Regalos tecnológicos personalizados para empresas | PromoPlanet',
    description: 'Cargadores, auriculares, parlantes y accesorios tecnológicos personalizados con logo. Regalos corporativos de tecnología para empresas.',
    intro: [
      'Los accesorios tecnológicos están entre los regalos corporativos más valorados: resuelven necesidades concretas del trabajo híbrido y se usan a diario.',
      'La categoría reúne cargadores inalámbricos, power banks, auriculares, parlantes bluetooth y accesorios de escritorio conectado. Son productos con alto valor percibido, adecuados para reconocimientos, regalos a clientes y kits de niveles superiores. Todos admiten personalización con logo, en general mediante grabado láser o impresión UV.'
    ]
  },
  {
    slug: 'escritorio-y-oficina',
    tipo: 'categoria',
    filtro: 'escritorio',
    h1: 'Cuadernos y agendas personalizados',
    title: 'Cuadernos y agendas personalizados para empresas | PromoPlanet',
    description: 'Cuadernos anillados, agendas, libretas y organizadores de escritorio personalizados con logo. Merchandising corporativo para la oficina y el home office.',
    intro: [
      'Los artículos de escritorio mantienen la marca presente en el lugar de trabajo, tanto en la oficina como en el home office.',
      'La categoría tiene su eje en los cuadernos y agendas: cuadernos anillados, libretas con tapa dura y agendas en distintos formatos, que se personalizan con logo en tapa mediante estampado, grabado o serigrafía. Se completa con organizadores de escritorio, y es un componente habitual de kits de onboarding y materiales de capacitación.'
    ]
  },
  {
    slug: 'outdoors-y-fitness',
    tipo: 'categoria',
    filtro: 'outdoors',
    h1: 'Sets parrilleros y paraguas personalizados',
    title: 'Sets parrilleros y paraguas personalizados para empresas | PromoPlanet',
    description: 'Sets parrilleros, paraguas, sets de picnic y loncheras térmicas personalizados con logo. Regalos corporativos para el aire libre y el tiempo compartido.',
    intro: [
      'Los productos de outdoors llevan la marca fuera de la oficina: acompañan el asado, el picnic y los momentos al aire libre.',
      'La categoría tiene dos ejes fuertes: los sets parrilleros y de gastronomía —cuchillos, tablas y accesorios en estuches de madera— y los paraguas, desde el compacto de cortesía hasta el ejecutivo y el de golf. Se completan con loncheras térmicas, sets de picnic y artículos de camping. Los sets parrilleros son un clásico del regalo corporativo de jerarquía, muy elegidos para reconocimientos y fin de año.'
    ]
  },
  {
    slug: 'indumentaria-corporativa',
    tipo: 'categoria',
    filtro: 'indumentaria',
    h1: 'Indumentaria corporativa personalizada',
    title: 'Indumentaria corporativa personalizada — Remeras, buzos y camperas | PromoPlanet',
    description: 'Remeras, buzos, chombas y camperas personalizadas con logo para empresas. Indumentaria corporativa bordada o estampada, con curva de talles.',
    intro: [
      'La indumentaria corporativa cumple una doble función: uniforma equipos y convierte a cada persona en un punto de contacto con la marca.',
      'La línea abarca remeras, chombas, buzos, camperas y chalecos en distintas calidades de tela, con curva de talles completa. La personalización se realiza por bordado o estampado según la prenda y el diseño. Es una categoría central en kits de onboarding, eventos internos y acciones de employer branding.'
    ]
  },
  {
    slug: 'llaveros-y-accesorios',
    tipo: 'categoria',
    filtro: 'llaveros',
    h1: 'Llaveros personalizados y accesorios con logo',
    title: 'Llaveros personalizados y accesorios con logo para empresas | PromoPlanet',
    description: 'Llaveros de metal, bambú y acrílico personalizados con logo. Accesorios promocionales de bajo costo para eventos, activaciones y regalos masivos.',
    intro: [
      'Los llaveros son el formato promocional más masivo: bajo costo unitario, personalización visible y utilidad inmediata.',
      'La línea incluye llaveros de metal, bambú, cuero ecológico y acrílico, junto con accesorios como pins, cintas portacredencial y tarjeteros. Por sus mínimos accesibles, son la opción habitual para eventos de gran escala, activaciones de marca y complemento de kits más completos.'
    ]
  },
  {
    slug: 'onboarding',
    tipo: 'ocasion',
    filtro: 'onboarding',
    h1: 'Kits de onboarding y bienvenida',
    title: 'Kits de onboarding y bienvenida para empresas | PromoPlanet',
    description: 'Kits de bienvenida personalizados para nuevos ingresos: drinkware, cuadernos, mochilas y tecnología combinados por presupuesto y armados listos para entregar.',
    intro: [
      'El kit de bienvenida es la primera experiencia material que un nuevo ingreso tiene con la empresa, y las áreas de Recursos Humanos lo saben: es una de las categorías de mayor crecimiento en regalos corporativos.',
      'Los kits se arman combinando productos del catálogo según presupuesto y perfil: drinkware, cuaderno, bolígrafo, mochila o tote, y accesorios tecnológicos. Incluyen personalización con logo y packaging de presentación, y se entregan armados y listos para el primer día.'
    ]
  },
  {
    slug: 'fechas-especiales',
    tipo: 'ocasion',
    filtro: 'fechas',
    h1: 'Regalos corporativos para fechas especiales',
    title: 'Regalos corporativos de fin de año y fechas especiales | PromoPlanet',
    description: 'Regalos empresariales para fin de año, aniversarios y fechas conmemorativas. Productos personalizados con logo, con opciones para cada presupuesto.',
    intro: [
      'Las fechas especiales concentran la mayor demanda del año en regalos corporativos: el cierre de diciembre, los aniversarios de empresa y las fechas conmemorativas del calendario.',
      'La selección abarca desde artículos individuales hasta kits armados por presupuesto: drinkware premium, textiles, tecnología y opciones sustentables. Conviene planificar con anticipación, en especial para fin de año, cuando los plazos de personalización y entrega se acortan en todo el rubro.'
    ]
  },
  {
    slug: 'reconocimiento',
    tipo: 'ocasion',
    filtro: 'reconocimiento',
    h1: 'Regalos de reconocimiento y premios corporativos',
    title: 'Regalos de reconocimiento y premios corporativos | PromoPlanet',
    description: 'Regalos corporativos para programas de reconocimiento: premios por antigüedad, logros de equipo y cierres de año. Productos de alto valor percibido.',
    intro: [
      'Los programas de reconocimiento necesitan regalos que estén a la altura del gesto: productos de mayor jerarquía que un merchandising de evento, pensados para durar.',
      'La categoría reúne artículos de alto valor percibido: drinkware premium, sets de escritura, tecnología y accesorios de cuero o materiales nobles. Se utilizan en premios por antigüedad, reconocimientos trimestrales, logros de equipo y obsequios de cierre de año para posiciones de liderazgo.'
    ]
  },
  {
    slug: 'capacitacion',
    tipo: 'ocasion',
    filtro: 'capacitacion',
    h1: 'Kits para capacitaciones y jornadas de formación',
    title: 'Kits y materiales para capacitaciones y jornadas de formación | PromoPlanet',
    description: 'Cuadernos, bolígrafos, bolsas y kits personalizados para capacitaciones, workshops y jornadas de formación. Materiales con logo listos para entregar.',
    intro: [
      'Las capacitaciones y jornadas de formación funcionan mejor cuando cada asistente recibe su material completo desde el primer momento.',
      'El kit típico combina cuaderno, bolígrafo y una bolsa o carpeta contenedora, con la posibilidad de sumar drinkware o accesorios tecnológicos según el presupuesto. Todos los componentes se personalizan con el logo de la empresa o la identidad del programa de formación, y se entregan armados por asistente.'
    ]
  },
  {
    slug: 'eventos',
    tipo: 'ocasion',
    filtro: 'evento',
    h1: 'Merchandising para eventos corporativos',
    title: 'Merchandising para eventos corporativos y activaciones | PromoPlanet',
    description: 'Productos promocionales para eventos, ferias, congresos y activaciones de marca. Merchandising personalizado con mínimos accesibles y alto impacto.',
    intro: [
      'Los eventos corporativos, las ferias y las activaciones de marca requieren merchandising pensado para volumen: productos de entrega masiva que sostienen la presencia de la marca después del encuentro.',
      'La selección para eventos combina artículos de bajo costo unitario, como bolígrafos, llaveros y tote bags, con piezas de mayor jerarquía para oradores, sponsors e invitados destacados. Los mínimos accesibles y la variedad de técnicas de personalización permiten ajustar la propuesta a la escala de cada evento.'
    ]
  },
  {
    slug: 'sustentable',
    tipo: 'badge',
    filtro: 'ecofriendly',
    h1: 'Regalos corporativos sustentables',
    title: 'Regalos corporativos sustentables y eco-friendly | PromoPlanet',
    description: 'Productos promocionales sustentables: bambú, fibra de trigo, algodón orgánico y materiales reciclados. Regalos corporativos alineados con políticas ESG.',
    intro: [
      'Los regalos sustentables dejaron de ser un nicho: cada vez más empresas los eligen para alinear el merchandising con sus políticas ambientales y de ESG.',
      'La línea reúne productos de bambú, fibra de trigo, algodón orgánico, papel reciclado y plásticos recuperados: desde drinkware y cuadernos hasta kits completos de escritorio. Además del material, muchos artículos incorporan packaging reducido o reciclable, un detalle que suma en presentaciones institucionales.'
    ]
  }
];

module.exports = { LANDINGS };

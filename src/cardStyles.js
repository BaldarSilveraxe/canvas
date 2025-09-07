import Konva from 'https://esm.sh/konva@9';

// A reusable function to create the common shapes for a card
const createCardContainer = ({ w, h, headerH, style }) => {
  const container = new Konva.Group({ name: 'cardGroup' });
  const body = new Konva.Rect({
    name: 'body', // added a name to easily find this shape later
    width: w,
    height: h,
    stroke: style.stroke,
    strokeWidth: style.strokeWidth,
    fill: style.bodyFill,
    shadowForStrokeEnabled: false
  });
  const header = new Konva.Rect({
    name: 'header', // added a name to easily find this shape later
    width: w,
    height: headerH,
    fill: style.headerFill,
  });
  container.add(body, header);
  return { container, body, header };
};

// A map where each key is a styleName and the value is a function that creates the shapes for that style
export const cardStyles = {
  standard: (cardData) => {
    const headerH = 40;
    const { container, body, header } = createCardContainer({ ...cardData, headerH, style: cardData });
    body.cornerRadius(12);
    header.cornerRadius([12, 12, 0, 0]);
    return container;
  },

  sharp: (cardData) => {
    const headerH = 60;
    const { container, body, header } = createCardContainer({ ...cardData, headerH, style: cardData });
    // No specific corner radius, so shapes are sharp
    return container;
  },

  bottomRounded: (cardData) => {
    const headerH = 45;
    const { container, body, header } = createCardContainer({ ...cardData, headerH, style: cardData });
    body.cornerRadius([0, 0, 12, 12]);
    header.cornerRadius([12, 12, 0, 0]);
    return container;
  },

  // This is the default style that will be used if no styleKey is provided
  default: (cardData) => {
    const headerH = 40;
    const { container, body, header } = createCardContainer({ ...cardData, headerH, style: cardData });
    body.fill('gray');
    header.fill('darkgray');
    return container;
  }
};

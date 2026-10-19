type ImageReferenceProps = {
  image?: string;
};

// An image reference pinned by digest is far wider than its column, which
// truncates it. The title keeps the whole reference within reach.
const ImageReference: React.FC<ImageReferenceProps> = ({ image }) =>
  image ? (
    <span className="pf-v6-u-font-family-monospace" title={image}>
      {image}
    </span>
  ) : (
    <>-</>
  );

export default ImageReference;

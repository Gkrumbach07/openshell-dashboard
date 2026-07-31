import { Content, Label, LabelGroup } from '@patternfly/react-core';

type LabelsListProps = {
  labels?: Record<string, string>;
  numLabels?: number;
};

const LabelsList: React.FC<LabelsListProps> = ({ labels, numLabels = 3 }) => {
  const entries = Object.entries(labels ?? {});
  if (entries.length === 0) {
    return <Content component="small">-</Content>;
  }
  return (
    <LabelGroup numLabels={numLabels}>
      {entries.map(([key, value]) => (
        <Label key={key} color="grey" isCompact>
          {key}={value}
        </Label>
      ))}
    </LabelGroup>
  );
};

export default LabelsList;

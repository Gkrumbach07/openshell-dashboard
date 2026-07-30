import { Content, Label, LabelGroup } from '@patternfly/react-core';

type LabelsListProps = {
  labels?: Record<string, string>;
};

const LabelsList: React.FC<LabelsListProps> = ({ labels }) => {
  const entries = Object.entries(labels ?? {});
  if (entries.length === 0) {
    return <Content component="small">-</Content>;
  }
  return (
    <LabelGroup numLabels={3}>
      {entries.map(([key, value]) => (
        <Label key={key} color="grey" isCompact>
          {key}={value}
        </Label>
      ))}
    </LabelGroup>
  );
};

export default LabelsList;

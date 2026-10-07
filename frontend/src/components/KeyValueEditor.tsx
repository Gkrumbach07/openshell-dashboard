import {
  Button,
  Grid,
  GridItem,
  Stack,
  StackItem,
  TextInput,
} from '@patternfly/react-core';

type KeyValueRow = {
  key: string;
  value: string;
};

type KeyValueEditorProps = {
  rows: KeyValueRow[];
  onChange: (rows: KeyValueRow[]) => void;
  keyPlaceholder?: string;
  valuePlaceholder?: string;
  testIdPrefix?: string;
  addLabel?: string;
  // What one row is, in the singular: "Label", "Annotation", "Environment
  // variable". It names the two inputs of a row for a screen reader ("Label
  // key", "Label value"), which otherwise have only a placeholder to go by.
  itemLabel?: string;
};

const KeyValueEditor: React.FC<KeyValueEditorProps> = ({
  rows,
  onChange,
  keyPlaceholder = 'key',
  valuePlaceholder = 'value',
  testIdPrefix = 'kv',
  addLabel = 'Add entry',
  itemLabel = 'Config',
}) => {
  const updateRow = (index: number, field: 'key' | 'value', val: string) => {
    onChange(rows.map((r, i) => (i === index ? { ...r, [field]: val } : r)));
  };

  const removeRow = (index: number) => {
    onChange(rows.filter((_, i) => i !== index));
  };

  const addRow = () => {
    onChange([...rows, { key: '', value: '' }]);
  };

  // A block of its own: a PatternFly Stack is as tall as its container, and
  // directly inside a form group it takes the whole height and pushes the add
  // button, and any helper text after the editor, over the next field.
  return (
    <div>
      {rows.length > 0 && (
        <Stack hasGutter>
          {rows.map((row, index) => (
            <StackItem key={index}>
              <Grid hasGutter>
                <GridItem span={5}>
                  <TextInput
                    id={`${testIdPrefix}-key-${index}`}
                    data-testid={`${testIdPrefix}-key-${index}`}
                    value={row.key}
                    onChange={(_event, value) => updateRow(index, 'key', value)}
                    placeholder={keyPlaceholder}
                    aria-label={`${itemLabel} key`}
                  />
                </GridItem>
                <GridItem span={5}>
                  <TextInput
                    id={`${testIdPrefix}-value-${index}`}
                    data-testid={`${testIdPrefix}-value-${index}`}
                    value={row.value}
                    onChange={(_event, value) =>
                      updateRow(index, 'value', value)
                    }
                    placeholder={valuePlaceholder}
                    aria-label={`${itemLabel} value`}
                  />
                </GridItem>
                <GridItem span={2}>
                  <Button
                    variant="link"
                    onClick={() => removeRow(index)}
                    data-testid={`${testIdPrefix}-remove-${index}`}
                  >
                    Remove
                  </Button>
                </GridItem>
              </Grid>
            </StackItem>
          ))}
        </Stack>
      )}
      <Button
        variant="link"
        isInline
        onClick={addRow}
        data-testid={`${testIdPrefix}-add`}
      >
        {addLabel}
      </Button>
    </div>
  );
};

export default KeyValueEditor;

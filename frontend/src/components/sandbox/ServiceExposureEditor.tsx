import {
  Button,
  Grid,
  GridItem,
  Stack,
  StackItem,
  TextInput,
} from '@patternfly/react-core';

import type { ServiceExposureRow } from '../../utils/sandboxOptions';

type ServiceExposureEditorProps = {
  rows: ServiceExposureRow[];
  onChange: (rows: ServiceExposureRow[]) => void;
  testIdPrefix?: string;
};

// The services to expose with a sandbox as it is created: a port of the
// sandbox and, optionally, a name. A row without a name is the sandbox's
// unnamed service.
const ServiceExposureEditor: React.FC<ServiceExposureEditorProps> = ({
  rows,
  onChange,
  testIdPrefix = 'expose',
}) => {
  const updateRow = (
    index: number,
    field: keyof ServiceExposureRow,
    value: string,
  ) => {
    onChange(rows.map((r, i) => (i === index ? { ...r, [field]: value } : r)));
  };

  // A block of its own, as in KeyValueEditor and for the same reason: a Stack
  // directly inside a form group takes the group's whole height.
  return (
    <div>
      {rows.length > 0 && (
        <Stack hasGutter>
          {rows.map((row, index) => (
            <StackItem key={index}>
              <Grid hasGutter>
                <GridItem span={6}>
                  <TextInput
                    id={`${testIdPrefix}-service-${index}`}
                    data-testid={`${testIdPrefix}-service-${index}`}
                    value={row.service}
                    onChange={(_event, value) =>
                      updateRow(index, 'service', value)
                    }
                    placeholder="Name (optional)"
                    aria-label="Service name"
                  />
                </GridItem>
                <GridItem span={4}>
                  <TextInput
                    id={`${testIdPrefix}-port-${index}`}
                    data-testid={`${testIdPrefix}-port-${index}`}
                    value={row.port}
                    onChange={(_event, value) =>
                      updateRow(index, 'port', value)
                    }
                    placeholder="Port (e.g. 8080)"
                    aria-label="Service port"
                  />
                </GridItem>
                <GridItem span={2}>
                  <Button
                    variant="link"
                    onClick={() => onChange(rows.filter((_, i) => i !== index))}
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
        onClick={() => onChange([...rows, { service: '', port: '' }])}
        data-testid={`${testIdPrefix}-add`}
      >
        Add service
      </Button>
    </div>
  );
};

export default ServiceExposureEditor;

import React from 'react';
import {
  Flex,
  FlexItem,
  FormSelect,
  FormSelectOption,
  TextInput,
} from '@patternfly/react-core';

import {
  SETTING_TYPES,
  emptySettingText,
  type SettingType,
} from '../utils/settings';

type SettingValueFieldProps = {
  // Prefix for the element ids of the two controls.
  id: string;
  // data-testid of the value control.
  valueTestId: string;
  type: SettingType;
  // Whether the type can be chosen. False when the gateway reported the
  // setting's current value, whose type is the one the setting takes.
  canChooseType: boolean;
  // What the value control holds: the text of a string or an integer, or
  // "true" / "false" for a boolean.
  text: string;
  onChange: (type: SettingType, text: string) => void;
  // Put the cursor in the value control when it appears.
  focusOnMount?: boolean;
};

// The value of a gateway setting, entered as the type the gateway takes it in.
const SettingValueField: React.FC<SettingValueFieldProps> = ({
  id,
  valueTestId,
  type,
  canChooseType,
  text,
  onChange,
  focusOnMount,
}) => (
  <Flex
    gap={{ default: 'gapSm' }}
    flexWrap={{ default: 'nowrap' }}
    alignItems={{ default: 'alignItemsCenter' }}
  >
    {canChooseType && (
      <FlexItem>
        <FormSelect
          id={`${id}-type`}
          data-testid={`${valueTestId}-type`}
          aria-label="Value type"
          value={type}
          onChange={(_event, next) =>
            onChange(next as SettingType, emptySettingText(next as SettingType))
          }
        >
          {SETTING_TYPES.map((option) => (
            <FormSelectOption
              key={option.type}
              value={option.type}
              label={option.label}
            />
          ))}
        </FormSelect>
      </FlexItem>
    )}
    <FlexItem flex={{ default: 'flex_1' }}>
      {type === 'boolean' ? (
        <FormSelect
          id={id}
          data-testid={valueTestId}
          aria-label="Value"
          value={text}
          onChange={(_event, next) => onChange(type, next)}
        >
          <FormSelectOption value="true" label="true" />
          <FormSelectOption value="false" label="false" />
        </FormSelect>
      ) : (
        <TextInput
          id={id}
          data-testid={valueTestId}
          aria-label="Value"
          type={type === 'integer' ? 'number' : 'text'}
          value={text}
          onChange={(_event, next) => onChange(type, next)}
          // eslint-disable-next-line jsx-a11y/no-autofocus
          autoFocus={focusOnMount}
        />
      )}
    </FlexItem>
  </Flex>
);

export default SettingValueField;

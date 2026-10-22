import { useEffect, useRef, useState } from 'react';
import type { RefObject } from 'react';
import {
  Button,
  Flex,
  FlexItem,
  FormSelect,
  FormSelectOption,
} from '@patternfly/react-core';
import { AngleLeftIcon, AngleRightIcon } from '@patternfly/react-icons';
import { useI18n } from '../i18n';

type CursorPaginationProps = {
  variant: 'top' | 'bottom';
  page: number;
  perPage: number;
  hasNext: boolean;
  isLoading?: boolean;
  isError?: boolean;
  resultsRef?: RefObject<HTMLHeadingElement>;
  onPrevious: () => void;
  onNext: () => void;
  onPerPageSelect: (size: number) => void;
};

const CursorPagination: React.FC<CursorPaginationProps> = ({
  variant,
  page,
  perPage,
  hasNext,
  isLoading = false,
  isError = false,
  resultsRef,
  onPrevious,
  onNext,
  onPerPageSelect,
}) => {
  const { t } = useI18n('common');
  const lastAnnouncedPage = useRef(page);
  const pendingFocusPage = useRef<number | null>(null);
  const [announcement, setAnnouncement] = useState('');

  useEffect(() => {
    if (variant !== 'bottom' || isLoading || isError) return;
    if (lastAnnouncedPage.current !== page) {
      lastAnnouncedPage.current = page;
      setAnnouncement(t('pagination.loaded', { number: page }));
    }
    if (pendingFocusPage.current === page) {
      pendingFocusPage.current = null;
      resultsRef?.current?.focus();
    }
  }, [variant, page, perPage, isLoading, isError, resultsRef, t]);

  const navigate = (targetPage: number, action: () => void) => {
    if (variant === 'bottom') pendingFocusPage.current = targetPage;
    action();
  };

  return (
    <Flex
      component="nav"
      aria-label={
        variant === 'top'
          ? t('pagination.topNavigation')
          : t('pagination.bottomNavigation')
      }
      alignItems={{ default: 'alignItemsCenter' }}
      justifyContent={
        variant === 'bottom'
          ? { default: 'justifyContentCenter', md: 'justifyContentFlexEnd' }
          : undefined
      }
      flexWrap={{ default: 'nowrap' }}
      gap={{ default: 'gapSm' }}
      className={variant === 'bottom' ? 'pf-v6-u-mt-md' : undefined}
    >
      {variant === 'bottom' && (
        <FlexItem>
          <FormSelect
            aria-label={t('pagination.itemsPerPage')}
            value={String(perPage)}
            isDisabled={isLoading}
            onChange={(_event, value) => {
              pendingFocusPage.current = 1;
              onPerPageSelect(Number(value));
            }}
          >
            {[10, 20, 50, 100].map((size) => (
              <FormSelectOption
                key={size}
                value={String(size)}
                label={t('pagination.perPage', { count: size })}
              />
            ))}
          </FormSelect>
        </FlexItem>
      )}
      <FlexItem
        className={
          variant === 'top'
            ? 'pf-v6-u-display-none pf-v6-u-display-block-on-md'
            : undefined
        }
      >
        <Button
          variant="plain"
          icon={<AngleLeftIcon />}
          aria-label={t('pagination.previous')}
          isDisabled={page === 1 || isLoading}
          onClick={() => navigate(page - 1, onPrevious)}
        />
      </FlexItem>
      <FlexItem>
        <span className="pf-v6-u-text-nowrap" aria-current="page">
          {t('pagination.page', { number: page })}
        </span>
      </FlexItem>
      <FlexItem
        className={
          variant === 'top'
            ? 'pf-v6-u-display-none pf-v6-u-display-block-on-md'
            : undefined
        }
      >
        <Button
          variant="plain"
          icon={<AngleRightIcon />}
          aria-label={t('pagination.next')}
          isDisabled={!hasNext || isLoading || isError}
          onClick={() => navigate(page + 1, onNext)}
        />
      </FlexItem>
      {variant === 'bottom' && (
        <span className="pf-v6-screen-reader" role="status" aria-live="polite">
          {announcement}
        </span>
      )}
    </Flex>
  );
};

export default CursorPagination;

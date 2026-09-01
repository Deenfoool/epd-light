import { FNS_ETRN_REFERENCE, cargoTotals, normalizeEtrn, operatorReadiness } from './etrn'
import type { DocumentRow, Party, RussianAddressDraft } from './types'

export type OperatorPartyCandidate = {
  kind: 'org' | 'ip'
  name: string
  inn: string
  kpp: string
  address: string
  russianAddress: RussianAddressDraft
  phone: string
  email: string
  edoId: string
}

const address = (a?: RussianAddressDraft): RussianAddressDraft => ({
  zipCode: a?.zipCode ?? '', region: a?.region ?? '', city: a?.city ?? '', settlement: a?.settlement ?? '',
  street: a?.street ?? '', building: a?.building ?? '', corpus: a?.corpus ?? '', apartment: a?.apartment ?? '',
})
const party = (p: Party): OperatorPartyCandidate => ({
  kind: p.kind,
  name: p.name,
  inn: p.inn,
  kpp: p.kpp,
  address: p.address,
  russianAddress: address(p.russianAddress),
  phone: p.phone,
  email: p.email,
  edoId: p.edoId ?? '',
})

/**
 * Builds an operator-neutral integration candidate from the internal draft.
 * It is intentionally NOT XML, NOT an FNS XSD document and NOT a request body
 * for Kontur, Taxcom or any other accredited operator.
 *
 * A provider adapter must transform this structure on the server after the
 * actual API contract and credentials are available.
 */
export function buildOperatorDraft(doc: DocumentRow) {
  const d = normalizeEtrn(doc.data)
  const readiness = operatorReadiness(d)
  const totals = cargoTotals(d)
  const loading = d.loadingDetails!

  return {
    kind: 'epd-light/operator-candidate-v1',
    draftModelVersion: 4,
    disclaimer: 'Интеграционный черновик. Не является XML ФНС, ЭТрН, подписью или фактом передачи в ГИС ЭПД.',
    mappingReference: {
      ...FNS_ETRN_REFERENCE,
      mappingScope: 'Т1 / информация грузоотправителя, предварительное сопоставление полей',
    },
    providerHints: {
      kontur: {
        observedAt: '2026-09-01',
        documentTypeNamedId: 'LogisticsWaybill',
        documentFunction: 'reception',
        documentVersion: 'kl_trn_mt_05_01',
        generationTitleIndex: 0,
        previewOnly: true,
      },
    },
    readiness: {
      candidate: readiness.candidate,
      operatorFieldsMissing: readiness.missing,
      warnings: readiness.warnings,
    },
    document: {
      number: doc.doc_number,
      date: doc.doc_date,
      orderNumber: d.terms.orderNumber ?? '',
      orderDate: d.terms.orderDate ?? '',
      contractNumber: d.terms.contractNumber,
      contractDate: d.terms.contractDate,
    },
    participants: {
      shipper: party(d.shipper),
      consignee: party(d.consignee),
      carrier: party(d.carrier),
    },
    route: {
      loadingAddress: d.route.loadAddress,
      loadingRussianAddress: address(d.route.loadRussianAddress),
      plannedLoadingDate: d.route.loadDate,
      plannedLoadingTime: d.route.loadTime,
      actualArrival: d.route.loadArrival ?? '',
      actualDeparture: d.route.loadDeparture ?? '',
      unloadingAddress: d.route.unloadAddress,
      unloadingRussianAddress: address(d.route.unloadRussianAddress),
      plannedUnloadingDate: d.route.unloadDate,
      plannedUnloadingTime: d.route.unloadTime,
      note: d.route.note,
    },
    loadingFacts: {
      actualGrossWeight: d.route.actualWeight || String(totals.weight || ''),
      actualPlaces: d.route.actualPlaces || String(totals.places || ''),
      massDeterminationMethod: d.route.massMethod ?? '',
    },
    loadingDetails: {
      matchingShipper: loading.matchingShipper,
      employeeFullName: loading.employeeFullName,
      employeePosition: loading.employeePosition,
      employeeResponsibilities: loading.employeeResponsibilities,
      partyInn: loading.partyInn || (loading.matchingShipper === '1' ? d.shipper.inn : ''),
      ownerType: loading.ownerType,
      ownerInn: loading.ownerInn,
    },
    cargo: d.cargo.map((x) => ({
      internalId: x.id,
      name: x.name,
      state: x.state ?? '',
      places: x.places,
      unit: x.unit,
      grossWeightKg: x.weight,
      declaredValue: x.value,
      currencyCode: x.currency ?? '643',
      packaging: x.packaging,
      packagingMethod: x.packagingMethod ?? '',
      packagingCode: x.packagingCode ?? '',
      marking: x.marking ?? '',
      specialConditions: x.conditions,
    })),
    vehicle: {
      registrationNumber: d.transport.plate,
      trailerRegistrationNumber: d.transport.trailerPlate,
      type: d.transport.vehicleType ?? '',
      brand: d.transport.brand,
      model: d.transport.model,
      ownershipType: d.transport.ownershipType ?? '',
      loadCapacity: d.transport.loadCapacity ?? '',
      volumeCapacity: d.transport.volumeCapacity ?? '',
    },
    driver: {
      fullName: d.transport.driverName,
      phone: d.transport.driverPhone,
      licenseLegacy: d.transport.driverLicense,
      licenseSeries: d.transport.driverLicenseSeries ?? '',
      licenseNumber: d.transport.driverLicenseNumber ?? '',
      licenseIssueDate: d.transport.driverLicenseDate ?? '',
      waybillNumber: d.transport.waybillNumber ?? '',
      waybillDate: d.transport.waybillDate ?? '',
    },
    shipperInstructions: {
      instructions: d.terms.shipperInstructions ?? '',
      redirectionContact: d.terms.redirectionContact ?? '',
    },
    signer: {
      fullName: d.signer?.fullName ?? '',
      position: d.signer?.position ?? '',
    },
    commercial: {
      carriagePrice: d.terms.price,
      comment: d.terms.comment,
      extra: d.terms.extra,
    },
    unresolvedByDesign: [
      'полные перечисления OrgType/Ownership/WeighingMethod/ContainerType/LoadingOwnerDetails.Type и условная обязательность берутся из актуального UserDataXsd/GetDocumentTypes',
      'LoadingPartyDetails и LoadingOwnerDetails генерируются только при явно заполненных пользователем данных; отсутствие этих блоков пока не трактуется как XSD-ошибка',
      'datetime-local не содержит часовой пояс; текущий preview использует EnablingTimeZone=0 и не должен идти в GenerateTitleXml до sandbox-проверки',
      'ИП и иные типы участников должны быть проверены по актуальному UserDataXsd до генерации',
      'формирование имени итогового XML и транспортного контейнера',
      'подписание КЭП/УНЭП и юридически значимые статусы',
    ],
  }
}

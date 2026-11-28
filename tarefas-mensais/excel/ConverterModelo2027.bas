Attribute VB_Name = "ConverterModelo2027"
' Converte uma planilha de cliente do modelo antigo (COTA, Performance,
' Relatorio, Base Extrato, Extrato) para o modelo 2027 (igual a LuizFLM_2027).
'
' Como usar:
'   1. Abra o modelo (Modelo2027.xlsx = LuizFLM_2027 antes da migracao) e a
'      planilha antiga do cliente (ex.: AliceMG.xlsx). Nos dois: "Nao atualizar".
'   2. Deixe a planilha do cliente ATIVA e rode ConverterParaModelo2027.
'   3. A macro salva uma copia nova "<nome>_2027.xlsx" na mesma pasta antes de
'      mexer em qualquer coisa. O arquivo antigo fica intacto.
'
' O que muda:
'   - COTA: cria a classe POS (linha de cota + bloco de saldos, cota 1 no
'     ultimo fechamento mensal), troca Estruturado -> Alternativo e marca em
'     amarelo as classes digitadas (Estruturado -> Alternativo; papeis RF -> POS).
'   - Apaga as abas antigas e copia do modelo: Base Relatorio, Performance,
'     Relatorio, Extrato, Fechamento, Exportacao.
'   - Performance: historico digitado do cliente + formulas do modelo depois.
'   - Base Relatorio: cliente, data-base e corretoras do cliente.
'
' Fonte so com ASCII de proposito; acentos via ChrW.
Option Explicit

Private Const AMARELO As Long = 65535

Private Function sBaseRel() As String: sBaseRel = "Base Relat" & ChrW(243) & "rio": End Function
Private Function sRelatorio() As String: sRelatorio = "Relat" & ChrW(243) & "rio": End Function
Private Function sExportacao() As String: sExportacao = "Exporta" & ChrW(231) & ChrW(227) & "o": End Function
Private Function sPOS() As String: sPOS = "P" & ChrW(211) & "S": End Function
Private Function sPapeis() As String: sPapeis = "PAP" & ChrW(201) & "IS": End Function

Public Sub ConverterParaModelo2027()
    Dim wb As Workbook, tpl As Workbook, w As Workbook
    Dim cota As Worksheet, ws As Worksheet
    Dim nomes As Variant, i As Long, msg As String

    Set wb = ActiveWorkbook
    If Not TemAba(wb, "COTA") Then MsgBox "A planilha ativa nao tem a aba COTA.", vbExclamation: Exit Sub
    If TemAba(wb, sBaseRel()) Then MsgBox "Esta planilha ja esta no modelo 2027.", vbExclamation: Exit Sub
    If TemAba(wb, "COTA USD") Then MsgBox "Planilha com COTA USD: conversao ainda nao suportada.", vbExclamation: Exit Sub

    For Each w In Workbooks
        If Not w Is wb Then
            If TemAba(w, sBaseRel()) And TemAba(w, sExportacao()) And TemAba(w, "COTA") Then Set tpl = w: Exit For
        End If
    Next w
    If tpl Is Nothing Then MsgBox "Abra o modelo (Modelo2027.xlsx) antes de rodar.", vbExclamation: Exit Sub

    Set cota = wb.Worksheets("COTA")
    If Trim(CStr(cota.Range("B3").Value)) <> "RF" Or Trim(CStr(cota.Range("E39").Value)) <> "TOTAL" Then
        MsgBox "A COTA desta planilha nao tem o layout antigo esperado (RF em B3, TOTAL em E39).", vbExclamation
        Exit Sub
    End If

    ' parametros
    Dim cliente As String, dataBase As Variant, novo As String, sufixo As Long
    cliente = wb.Name
    If InStrRev(cliente, ".") > 0 Then cliente = Left(cliente, InStrRev(cliente, ".") - 1)
    novo = wb.Path & IIf(Left(wb.Path, 4) = "http", "/", Application.PathSeparator) & cliente & "_2027.xlsx"
    For i = Len(cliente) To 2 Step -1
        If Mid(cliente, i, 1) Like "[a-z]" Then Exit For
    Next i
    cliente = InputBox("Nome do cliente no relatorio:", "Modelo 2027", Left(cliente, i))
    If cliente = "" Then Exit Sub
    dataBase = InputBox("Data-base (dd/mm/aaaa):", "Modelo 2027", Format(DateSerial(Year(Date), Month(Date), 0), "dd/mm/yyyy"))
    If Not IsDate(dataBase) Then Exit Sub
    dataBase = CDate(dataBase)

    If MsgBox("Planilha: " & wb.Name & vbLf & "Modelo: " & tpl.Name & vbLf & vbLf & _
              "Vou salvar uma copia nova:" & vbLf & novo & vbLf & "e converter essa copia. O arquivo atual nao muda." & vbLf & vbLf & "Continuar?", _
              vbQuestion + vbOKCancel, "Modelo 2027") <> vbOK Then Exit Sub

    ' guarda historico da Performance antiga e o saldo da COTA antes de mexer
    Dim hist As Variant, nHist As Long, a6 As Variant, totAntes As Double, colDB As Long
    LerHistorico wb, hist, nHist, a6
    colDB = ColunaDaData(cota, CDate(dataBase))
    If colDB > 0 Then totAntes = Val(CStr(cota.Cells(41, colDB).Value))

    Application.ScreenUpdating = False
    Application.DisplayAlerts = False
    Application.Calculation = xlCalculationManual
    On Error GoTo Falha

    wb.SaveAs Filename:=novo, FileFormat:=xlOpenXMLWorkbook
    Set cota = wb.Worksheets("COTA")

    ' 1. COTA
    Dim nAlt As Long, nPos As Long
    AjustarCota cota, nAlt, nPos

    ' 2. abas antigas fora, abas do modelo dentro
    Dim linksAntes As Variant
    linksAntes = wb.LinkSources(xlExcelLinks)
    For i = wb.Worksheets.Count To 1 Step -1
        If wb.Worksheets(i).Name <> "COTA" Then wb.Worksheets(i).Visible = xlSheetVisible: wb.Worksheets(i).Delete
    Next i
    nomes = Array(sBaseRel(), "Performance", sRelatorio(), "Extrato", "Fechamento", sExportacao())
    tpl.Worksheets(nomes).Copy After:=wb.Worksheets("COTA")
    wb.Worksheets(sBaseRel()).Move Before:=wb.Worksheets("COTA")

    For i = LBound(nomes) To UBound(nomes)
        wb.Worksheets(nomes(i)).Cells.Replace What:="[" & tpl.Name & "]", Replacement:="", LookAt:=xlPart, MatchCase:=False
    Next i
    Dim restoLinks As String
    restoLinks = UnificarLinks(wb, tpl, linksAntes)

    ' 3. parametros do cliente
    Dim br As Worksheet, bancos As Collection
    Set br = wb.Worksheets(sBaseRel())
    br.Range("B5").Value = cliente
    br.Range("B6").Value = CDate(dataBase)
    br.Range("B18").Value = LinhaPrimeiroBanco(cota)
    Set bancos = BancosDaCota(cota, CLng(br.Range("B18").Value))
    br.Range("D6:E11").ClearContents
    For i = 1 To bancos.Count
        If i > 6 Then Exit For
        br.Cells(5 + i, 4).Value = bancos(i)
        br.Cells(5 + i, 5).Value = NomeRelatorioBanco(CStr(bancos(i)))
    Next i

    ' Extrato e Fechamento: limpa o que foi digitado para o Luiz
    With wb.Worksheets("Extrato")
        .Range("B4").ClearContents
        .Range("F5:L10").ClearContents
        For i = 1 To bancos.Count
            If i > 6 Then Exit For
            .Cells(4 + i, 6).Value = NomeRelatorioBanco(CStr(bancos(i)))
        Next i
    End With
    With wb.Worksheets("Fechamento")
        .Range("B4").Value = NomeRelatorioBanco(CStr(bancos(1)))
        .Range("F4:F10").ClearContents
        .Range("N14:P300").ClearContents
    End With

    ' 4. Performance: historico do cliente + formulas do modelo
    MontarPerformance wb.Worksheets("Performance"), hist, nHist, a6

    Application.Calculation = xlCalculationAutomatic
    Application.Calculate
    wb.Save

    msg = "Pronto: " & wb.Name & vbLf & vbLf & _
          "COTA: classe " & sPOS() & " criada; " & nPos & " papel(is) RF -> " & sPOS() & "; " & nAlt & " ativo(s) Estruturado -> Alternativo (em amarelo)." & vbLf & _
          "Performance: " & nHist & " meses de historico copiados." & vbLf & _
          "Corretoras: " & Juntar(bancos) & vbLf
    If colDB > 0 Then msg = msg & vbLf & "Saldo TOTAL na data-base antes: " & Format(totAntes, "#,##0.00") & vbLf & _
          "Saldo TOTAL na data-base agora: " & Format(Val(CStr(cota.Cells(45, colDB).Value)), "#,##0.00") & vbLf & _
          "Saldo final na " & sBaseRel() & ": " & Format(Val(CStr(br.Range("B24").Value)), "#,##0.00") & vbLf
    If restoLinks <> "" Then msg = msg & vbLf & "ATENCAO, vinculos restantes:" & vbLf & restoLinks
    Application.DisplayAlerts = True
    Application.ScreenUpdating = True
    MsgBox msg, vbInformation, "Modelo 2027"
    Exit Sub

Falha:
    Application.Calculation = xlCalculationAutomatic
    Application.DisplayAlerts = True
    Application.ScreenUpdating = True
    MsgBox "Erro " & Err.Number & ": " & Err.Description & vbLf & "Feche " & wb.Name & " SEM SALVAR e me mande este print.", vbCritical
End Sub

' ---------- COTA ----------
Private Sub AjustarCota(ws As Worksheet, nAlt As Long, nPos As Long)
    Dim lastCol As Long, colMes As Long, c As Long, r As Long, lastRow As Long

    lastCol = ws.Cells(3, ws.Columns.Count).End(xlToLeft).Column
    colMes = 8
    For c = 8 To lastCol
        If IsDate(ws.Cells(1, c).Value) And Not ws.Cells(1, c).HasFormula Then colMes = c
    Next c

    ' linha de cota POS (nova linha 4)
    ws.Rows(4).Insert Shift:=xlDown
    ws.Range("B4").Value = sPOS(): ws.Range("C4").Value = sPOS() & "1": ws.Range("D4").Value = sPOS() & "2"
    ws.Range("E4").Formula = "=E18": ws.Range("F4").Value = "Cota "
    ' bloco de saldos POS (novas linhas 16:18, logo depois do bloco RF em 13:15)
    ws.Rows("16:18").Insert Shift:=xlDown
    ws.Range("E16").Value = sPOS() & "1": ws.Range("E17").Value = sPOS() & "2": ws.Range("E18").Value = sPOS()
    ws.Range("F16").Value = "Saldo Inicial": ws.Range("F17").Value = "Movimenta" & ChrW(231) & ChrW(227) & "o ": ws.Range("F18").Value = "Saldo Final"
    ws.Range(ws.Cells(13, colMes), ws.Cells(15, lastCol)).Copy Destination:=ws.Cells(16, colMes)
    ws.Cells(4, colMes).Value = 1
    If lastCol > colMes Then
        ws.Range(ws.Cells(4, colMes + 1), ws.Cells(4, lastCol)).FormulaR1C1 = _
            "=IF(ISERROR(R[12]C/R[14]C[-1]*RC[-1])=TRUE,RC[-1],R[12]C/R[14]C[-1]*RC[-1])"
    End If

    ' Estruturado -> Alternativo nas linhas de classe
    For r = 1 To 50
        For c = 2 To 5
            If Not ws.Cells(r, c).HasFormula Then
                If Left(CStr(ws.Cells(r, c).Value), 11) = "Estruturado" Then
                    ws.Cells(r, c).Value = "Alternativo" & Mid(CStr(ws.Cells(r, c).Value), 12)
                End If
            End If
        Next c
    Next r

    ' classes dos ativos
    Dim secao As String, v As String, d As String
    lastRow = ws.Cells(ws.Rows.Count, 4).End(xlUp).Row
    For r = 51 To lastRow
        d = Trim(CStr(ws.Cells(r, 4).Value))
        If d = "" And Not ws.Cells(r, 5).HasFormula Then
            v = UCase(Trim(CStr(ws.Cells(r, 5).Value)))
            If v <> "" Then secao = v
        ElseIf d = "Classe" Then
            v = Trim(CStr(ws.Cells(r, 5).Value))
            If v = "Estruturado" Then
                ws.Cells(r, 5).Value = "Alternativo": ws.Cells(r, 5).Interior.Color = AMARELO: nAlt = nAlt + 1
            ElseIf v = "RF" And Left(secao, Len(sPapeis())) = sPapeis() Then
                ws.Cells(r, 5).Value = sPOS(): ws.Cells(r, 5).Interior.Color = AMARELO: nPos = nPos + 1
            End If
        End If
    Next r

    ws.Range("B2").Value = ChrW(9888) & " Classes digitadas em amarelo (col. E) " & ChrW(8211) & " ver aviso na " & sBaseRel() & "!G17"
End Sub

Private Function LinhaPrimeiroBanco(ws As Worksheet) As Long
    Dim r As Long
    For r = 47 To 200
        If Trim(CStr(ws.Cells(r, 4).Value)) = "" And EhBanco(CStr(ws.Cells(r, 5).Value)) Then LinhaPrimeiroBanco = r: Exit Function
    Next r
    LinhaPrimeiroBanco = 51
End Function

Private Function BancosDaCota(ws As Worksheet, r0 As Long) As Collection
    Dim col As New Collection, r As Long, v As String, lastRow As Long, x As Variant, tem As Boolean
    lastRow = ws.Cells(ws.Rows.Count, 4).End(xlUp).Row
    For r = r0 To lastRow
        If Trim(CStr(ws.Cells(r, 4).Value)) = "" And Not ws.Cells(r, 5).HasFormula Then
            v = Trim(CStr(ws.Cells(r, 5).Value))
            If EhBanco(v) Then
                tem = False
                For Each x In col
                    If x = v Then tem = True
                Next x
                If Not tem Then col.Add v
            End If
        End If
    Next r
    Set BancosDaCota = col
End Function

Private Function EhBanco(v As String) As Boolean
    Select Case UCase(Trim(v))
        Case "XP", "EQI", "BTG", "INTER", "BANCO INTER", "MONTE BRAVO", "AVENUE", "ITAU", "ITA" & ChrW(218), "SAFRA", "WARREN", "GENIAL", "NU", "NUINVEST"
            EhBanco = True
    End Select
End Function

Private Function NomeRelatorioBanco(v As String) As String
    If UCase(v) = "INTER" Then NomeRelatorioBanco = "BANCO INTER" Else NomeRelatorioBanco = v
End Function

Private Function ColunaDaData(ws As Worksheet, d As Date) As Long
    Dim c As Long, lastCol As Long, v As Variant
    lastCol = ws.Cells(1, ws.Columns.Count).End(xlToLeft).Column
    For c = 8 To lastCol
        v = ws.Cells(1, c).Value
        If IsDate(v) Then If CDate(v) <= d Then ColunaDaData = c
    Next c
End Function

' ---------- Performance ----------
Private Sub LerHistorico(wb As Workbook, hist As Variant, n As Long, a6 As Variant)
    Dim ws As Worksheet, r As Long, c As Long
    n = 0
    If Not TemAba(wb, "Performance") Then Exit Sub
    Set ws = wb.Worksheets("Performance")
    a6 = ws.Range("A6").Value
    ReDim hist(1 To 2000, 1 To 5)
    For r = 7 To 2006
        If ws.Cells(r, 1).HasFormula Or ws.Cells(r, 2).HasFormula Or Not IsDate(ws.Cells(r, 1).Value) Then Exit For
        n = n + 1
        For c = 1 To 5
            hist(n, c) = ws.Cells(r, c).Value
        Next c
    Next r
End Sub

Private Sub MontarPerformance(ws As Worksheet, hist As Variant, n As Long, a6 As Variant)
    Dim r0 As Long, r As Long, c As Long, f(1 To 5) As String, ultima As Long
    ' primeira linha com formula no modelo
    For r = 7 To 2000
        If ws.Cells(r, 2).HasFormula Then r0 = r: Exit For
    Next r
    If r0 = 0 Or n = 0 Then Exit Sub
    For c = 1 To 5
        f(c) = ws.Cells(r0, c).FormulaR1C1
    Next c
    ultima = ws.Cells(ws.Rows.Count, 1).End(xlUp).Row
    If ultima < r0 Then ultima = r0
    ws.Range(ws.Cells(7, 1), ws.Cells(ultima, 5)).ClearContents
    If Not IsEmpty(a6) Then ws.Range("A6").Value = a6
    For r = 1 To n
        For c = 1 To 5
            ws.Cells(6 + r, c).Value = hist(r, c)
        Next c
    Next r
    For c = 1 To 5
        ws.Range(ws.Cells(7 + n, c), ws.Cells(ultima, c)).FormulaR1C1 = f(c)
    Next c
End Sub

' ---------- vinculos ----------
Private Function UnificarLinks(wb As Workbook, tpl As Workbook, antes As Variant) As String
    Dim ls As Variant, i As Long, j As Long, novo As Boolean, alvo As String, resto As String
    ls = wb.LinkSources(xlExcelLinks)
    If IsEmpty(ls) Then Exit Function
    For i = LBound(ls) To UBound(ls)
        novo = True
        If Not IsEmpty(antes) Then
            For j = LBound(antes) To UBound(antes)
                If antes(j) = ls(i) Then novo = False
            Next j
        End If
        If novo Then
            alvo = ""
            If NomeArq(CStr(ls(i))) = tpl.Name Then
                alvo = wb.FullName
            ElseIf Not IsEmpty(antes) Then
                For j = LBound(antes) To UBound(antes)
                    If LCase(NomeArq(CStr(antes(j)))) = LCase(NomeArq(CStr(ls(i)))) Then alvo = antes(j)
                Next j
            End If
            If alvo <> "" Then
                On Error Resume Next
                wb.ChangeLink Name:=ls(i), NewName:=alvo, Type:=xlExcelLinks
                On Error GoTo 0
            End If
        End If
    Next i
    ls = wb.LinkSources(xlExcelLinks)
    If Not IsEmpty(ls) Then
        For i = LBound(ls) To UBound(ls)
            novo = True
            If Not IsEmpty(antes) Then
                For j = LBound(antes) To UBound(antes)
                    If antes(j) = ls(i) Then novo = False
                Next j
            End If
            If novo Then resto = resto & ls(i) & vbLf
        Next i
    End If
    UnificarLinks = resto
End Function

Private Function NomeArq(s As String) As String
    Dim i As Long
    i = InStrRev(s, "\")
    If InStrRev(s, "/") > i Then i = InStrRev(s, "/")
    NomeArq = Mid(s, i + 1)
End Function

Private Function Juntar(col As Collection) As String
    Dim x As Variant
    For Each x In col
        Juntar = Juntar & IIf(Juntar = "", "", ", ") & x
    Next x
End Function

Private Function TemAba(wb As Workbook, nome As String) As Boolean
    Dim ws As Object
    For Each ws In wb.Sheets
        If ws.Name = nome Then TemAba = True: Exit Function
    Next ws
End Function
